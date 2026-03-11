import hashlib
import struct
from pathlib import Path

from fastapi import APIRouter, HTTPException, Query

from backend.path_utils import resolve_project_dir

router = APIRouter(prefix="/api/diagnostics", tags=["diagnostics"])

_OGG_CRC_POLY = 0x04C11DB7
_OGG_CRC_TABLE: list[int] = []


def _build_ogg_crc_table() -> list[int]:
    table: list[int] = []
    for i in range(256):
        r = i << 24
        for _ in range(8):
            if r & 0x80000000:
                r = ((r << 1) ^ _OGG_CRC_POLY) & 0xFFFFFFFF
            else:
                r = (r << 1) & 0xFFFFFFFF
        table.append(r)
    return table


def _ogg_crc32(data: bytes | bytearray) -> int:
    global _OGG_CRC_TABLE
    if not _OGG_CRC_TABLE:
        _OGG_CRC_TABLE = _build_ogg_crc_table()

    crc = 0
    for byte in data:
        crc = ((crc << 8) ^ _OGG_CRC_TABLE[((crc >> 24) ^ byte) & 0xFF]) & 0xFFFFFFFF
    return crc


def _read_varint(buf: bytes, pos: int) -> tuple[int, int]:
    shift = 0
    value = 0
    while True:
        if pos >= len(buf):
            raise ValueError("Unexpected EOF while reading varint")
        b = buf[pos]
        pos += 1
        value |= (b & 0x7F) << shift
        if not (b & 0x80):
            return value, pos
        shift += 7
        if shift > 63:
            raise ValueError("Varint too large")


def _parse_taf_header(header_block: bytes) -> dict:
    payload_len = struct.unpack(">I", header_block[:4])[0]
    payload = header_block[4:4 + payload_len]

    audio_id = ""
    num_bytes = None
    sha1_hex = ""
    track_page_nums: list[int] = []
    ogg_granule_position = None
    ogg_packet_count = None
    taf_block_num = None
    pageno = None

    pos = 0
    while pos < len(payload):
        tag, pos = _read_varint(payload, pos)
        field = tag >> 3
        wire = tag & 0x07

        if wire == 0:
            value, pos = _read_varint(payload, pos)
            if field == 2:
                num_bytes = value
            elif field == 3:
                audio_id = str(value)
            elif field == 6:
                ogg_granule_position = value
            elif field == 7:
                ogg_packet_count = value
            elif field == 8:
                taf_block_num = value
            elif field == 9:
                pageno = value
        elif wire == 2:
            length, pos = _read_varint(payload, pos)
            data = payload[pos:pos + length]
            pos += length
            if field == 1 and len(data) == 20:
                sha1_hex = data.hex()
            elif field == 4:
                inner = 0
                while inner < len(data):
                    value, inner = _read_varint(data, inner)
                    track_page_nums.append(value)
        else:
            break

    return {
        "payload_len": payload_len,
        "audio_id": audio_id,
        "num_bytes": num_bytes,
        "sha1_hex": sha1_hex,
        "track_page_nums": track_page_nums,
        "ogg_granule_position": ogg_granule_position,
        "ogg_packet_count": ogg_packet_count,
        "taf_block_num": taf_block_num,
        "pageno": pageno,
    }


def _find_taf_file(project_dir: Path) -> Path:
    taf_files = sorted(project_dir.glob("*.taf"))
    if not taf_files:
        raise HTTPException(404, "Keine TAF-Datei im Projekt gefunden")
    return taf_files[0]


def _analyze_taf(taf_path: Path, include_pages: bool) -> dict:
    data = taf_path.read_bytes()
    if len(data) < 4096:
        raise HTTPException(400, "TAF-Datei ist kleiner als der 4K-Header")

    header_block = data[:4096]
    header = _parse_taf_header(header_block)
    audio_data = data[4096:]

    issues: list[dict] = []
    pages: list[dict] = []
    page_start_by_offset: dict[int, int] = {}
    pages_per_block: dict[int, int] = {}

    computed_sha1 = hashlib.sha1(audio_data).hexdigest()
    offset = 4096
    page_index = 0
    packet_count = 0
    crc_mismatch_count = 0
    block_crossing_count = 0
    serial_mismatch_count = 0
    sequence_gap_count = 0
    eos_pages = 0
    bos_pages = 0
    previous_seqno: int | None = None

    while offset < len(data):
        remaining = len(data) - offset
        if remaining < 27:
            issues.append(
                {
                    "type": "truncated_tail",
                    "offset": offset,
                    "remaining_bytes": remaining,
                }
            )
            break

        if data[offset:offset + 4] != b"OggS":
            issues.append(
                {
                    "type": "missing_capture_pattern",
                    "offset": offset,
                    "bytes": data[offset:offset + 16].hex(),
                }
            )
            break

        version = data[offset + 4]
        header_type = data[offset + 5]
        granule_pos = struct.unpack_from("<Q", data, offset + 6)[0]
        serial = struct.unpack_from("<I", data, offset + 14)[0]
        seqno = struct.unpack_from("<I", data, offset + 18)[0]
        crc_expected = struct.unpack_from("<I", data, offset + 22)[0]
        segment_count = data[offset + 26]

        if remaining < 27 + segment_count:
            issues.append(
                {
                    "type": "truncated_segment_table",
                    "offset": offset,
                    "segment_count": segment_count,
                    "remaining_bytes": remaining,
                }
            )
            break

        lacing = list(data[offset + 27:offset + 27 + segment_count])
        body_len = sum(lacing)
        page_len = 27 + segment_count + body_len

        if remaining < page_len:
            issues.append(
                {
                    "type": "truncated_page_body",
                    "offset": offset,
                    "page_len": page_len,
                    "remaining_bytes": remaining,
                }
            )
            break

        page = bytearray(data[offset:offset + page_len])
        struct.pack_into("<I", page, 22, 0)
        crc_actual = _ogg_crc32(page)
        crc_ok = crc_actual == crc_expected
        if not crc_ok:
            crc_mismatch_count += 1

        if serial != int(header["audio_id"] or 0):
            serial_mismatch_count += 1

        if previous_seqno is not None and seqno != previous_seqno + 1:
            sequence_gap_count += 1
        previous_seqno = seqno

        relative_start = offset - 4096
        relative_end = relative_start + page_len - 1
        block_start = relative_start // 4096
        block_end = relative_end // 4096
        crosses_block = block_start != block_end
        if crosses_block:
            block_crossing_count += 1

        if header_type & 0x02:
            bos_pages += 1
        if header_type & 0x04:
            eos_pages += 1

        packet_count += sum(1 for value in lacing if value < 255)
        page_start_by_offset[offset] = page_index
        pages_per_block[block_start] = pages_per_block.get(block_start, 0) + 1

        page_info = {
            "index": page_index,
            "offset": offset,
            "relative_offset": relative_start,
            "length": page_len,
            "version": version,
            "header_type": header_type,
            "continued": bool(header_type & 0x01),
            "bos": bool(header_type & 0x02),
            "eos": bool(header_type & 0x04),
            "granule_pos": granule_pos,
            "serial": serial,
            "seqno": seqno,
            "segment_count": segment_count,
            "body_len": body_len,
            "packet_ends": sum(1 for value in lacing if value < 255),
            "crc_expected": f"{crc_expected:08x}",
            "crc_actual": f"{crc_actual:08x}",
            "crc_ok": crc_ok,
            "block_start": block_start,
            "block_end": block_end,
            "crosses_block": crosses_block,
        }
        if include_pages:
            pages.append(page_info)

        offset += page_len
        page_index += 1

    chapter_offsets = []
    for idx, block_num in enumerate(header["track_page_nums"]):
        byte_offset = 4096 + (block_num * 4096)
        chapter_offsets.append(
            {
                "chapter_index": idx + 1,
                "block_num": block_num,
                "byte_offset": byte_offset,
                "exact_page_start": byte_offset in page_start_by_offset,
                "page_index": page_start_by_offset.get(byte_offset),
                "pages_in_block": pages_per_block.get(block_num, 0),
            }
        )
    chapter_offset_mismatch_count = sum(1 for item in chapter_offsets if not item["exact_page_start"])

    summary = {
        "taf_file": taf_path.name,
        "file_size": len(data),
        "audio_size": len(audio_data),
        "header": header,
        "computed_sha1_hex": computed_sha1,
        "sha1_matches_audio": computed_sha1 == header["sha1_hex"],
        "audio_size_matches_header": len(audio_data) == header["num_bytes"],
        "page_count": page_index,
        "packet_count": packet_count,
        "crc_mismatch_count": crc_mismatch_count,
        "block_crossing_count": block_crossing_count,
        "serial_mismatch_count": serial_mismatch_count,
        "sequence_gap_count": sequence_gap_count,
        "chapter_offset_mismatch_count": chapter_offset_mismatch_count,
        "bos_pages": bos_pages,
        "eos_pages": eos_pages,
        "issues": issues,
        "chapter_offsets": chapter_offsets,
        "pages_per_block": pages_per_block,
    }

    if serial_mismatch_count:
        issues.append(
            {
                "type": "serial_mismatch",
                "count": serial_mismatch_count,
                "expected_audio_id": header["audio_id"],
            }
        )
    if sequence_gap_count:
        issues.append({"type": "sequence_gap", "count": sequence_gap_count})
    if block_crossing_count:
        issues.append({"type": "block_crossing", "count": block_crossing_count})
    if crc_mismatch_count:
        issues.append({"type": "crc_mismatch", "count": crc_mismatch_count})
    if not summary["sha1_matches_audio"]:
        issues.append(
            {
                "type": "sha1_mismatch",
                "expected": header["sha1_hex"],
                "actual": computed_sha1,
            }
        )
    if not summary["audio_size_matches_header"]:
        issues.append(
            {
                "type": "audio_size_mismatch",
                "expected": header["num_bytes"],
                "actual": len(audio_data),
            }
        )
    if chapter_offset_mismatch_count:
        issues.append(
            {
                "type": "chapter_offset_mismatch",
                "count": chapter_offset_mismatch_count,
            }
        )
    if bos_pages != 1:
        issues.append({"type": "unexpected_bos_count", "count": bos_pages})
    if eos_pages != 1:
        issues.append({"type": "unexpected_eos_count", "count": eos_pages})

    return {
        "project": taf_path.parent.name,
        "summary": summary,
        "pages": pages if include_pages else None,
    }


@router.get("/project/{name:path}/taf")
async def project_taf_diagnostics(
    name: str,
    include_pages: bool = Query(False),
):
    project_dir = resolve_project_dir(name)
    if not project_dir.exists() or not project_dir.is_dir():
        raise HTTPException(404, "Project not found")

    taf_path = _find_taf_file(project_dir)
    return _analyze_taf(taf_path, include_pages=include_pages)
