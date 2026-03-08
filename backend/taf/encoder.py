"""TAF encoder using FFmpeg Opus output plus 4K OGG repacking.

The public API stays unchanged for the rest of the project:
- `open()`
- `new_chapter()`
- `encode(pcm_bytes)`
- `close()`

Internally this now follows the TonieToolbox-style flow much more closely:
1. accumulate PCM per chapter
2. encode each chapter to a normal Ogg/Opus file via FFmpeg/libopus
3. copy/normalize the first two pages
4. repack the remaining Opus packets into 4K-aligned OGG pages
5. write the TAF protobuf header
"""

import hashlib
import struct
import subprocess
import tempfile
import time
import wave
from pathlib import Path

from .header import create_taf_header_block
from .repack import OggPage, OpusPacket

TONIEFILE_FRAME_SIZE = 4096
TONIEFILE_FIRST_AUDIO_PAGE_SIZE = 0x0E00
TONIEFILE_MAX_CHAPTERS = 100
OPUS_CHANNELS = 2
OPUS_SAMPLING_RATE = 48000
COMMENT_DATA_SIZE = 0x1B4
MIN_SILENCE_PCM_BYTES = (OPUS_SAMPLING_RATE * OPUS_CHANNELS * 2) // 50  # 20ms stereo s16le
TEDDY_BENCH_AUDIO_ID_DEDUCT = 0x50000000


def generate_audio_id() -> int:
    return int(time.time()) - TEDDY_BENCH_AUDIO_ID_DEDUCT


def _add_opus_comment(buf: bytearray, pos: int, comment: bytes) -> int:
    struct.pack_into("<I", buf, pos, len(comment))
    pos += 4
    buf[pos:pos + len(comment)] = comment
    return pos + len(comment)


def _check_identification_header(page: OggPage) -> None:
    segment = page.segments[0]
    unpacked = struct.unpack("<8sBBHLH", segment.data[0:18])
    if unpacked[0] != b"OpusHead":
        raise RuntimeError("Invalid opus file: OpusHead signature not found")
    if unpacked[1] != 1:
        raise RuntimeError("Invalid opus file: Opus version mismatch")
    if unpacked[2] != OPUS_CHANNELS:
        raise RuntimeError(f"Only stereo Opus files are supported, found {unpacked[2]} channels")
    if unpacked[4] != OPUS_SAMPLING_RATE:
        raise RuntimeError(f"Sample rate must be 48 kHz, found {unpacked[4]} Hz")


def _prepare_opus_tags(page: OggPage, bitrate: int, vbr: bool = True) -> OggPage:
    page.segments.clear()

    comment_data = bytearray(COMMENT_DATA_SIZE)
    pos = 0
    comment_data[pos:pos + 8] = b"OpusTags"
    pos += 8

    pos = _add_opus_comment(comment_data, pos, b"TeddyTafForge")

    comments = [
        b"version=dev",
        b"encoder=libopus (via FFmpeg)",
        f"encoder_options=--bitrate {bitrate} {'--vbr' if vbr else '--cbr'}".encode("ascii"),
    ]
    struct.pack_into("<I", comment_data, pos, len(comments))
    pos += 4

    for comment in comments:
        pos = _add_opus_comment(comment_data, pos, comment)

    remain = len(comment_data) - pos - 4
    struct.pack_into("<I", comment_data, pos, remain)
    pos += 4
    comment_data[pos:pos + 4] = b"pad="
    comment_data = comment_data[:pos + remain]

    first_segment = True
    remaining = bytes(comment_data)
    while remaining:
        chunk = remaining[:255]
        segment = OpusPacket()
        segment.size = len(chunk)
        segment.data = chunk
        segment.spanning_packet = len(remaining) > 255
        segment.first_packet = first_segment
        page.segments.append(segment)
        remaining = remaining[255:]
        first_segment = False

    page.correct_values(0)
    return page


def _copy_first_and_second_page(in_file, out_file, serial: int, sha1, bitrate: int, vbr: bool = True) -> None:
    if not OggPage.seek_to_page_header(in_file):
        raise RuntimeError("First OGG page not found")
    page = OggPage(in_file)
    page.serial_no = serial
    page.checksum = page.calc_checksum()
    _check_identification_header(page)
    page.write_page(out_file, sha1)

    if not OggPage.seek_to_page_header(in_file):
        raise RuntimeError("Second OGG page not found")
    page = OggPage(in_file)
    page.serial_no = serial
    page.checksum = page.calc_checksum()
    page = _prepare_opus_tags(page, bitrate, vbr)
    page.write_page(out_file, sha1)


def _skip_first_two_pages(in_file) -> None:
    if not OggPage.seek_to_page_header(in_file):
        raise RuntimeError("First OGG page not found")
    page = OggPage(in_file)
    _check_identification_header(page)
    if not OggPage.seek_to_page_header(in_file):
        raise RuntimeError("Second OGG page not found")
    OggPage(in_file)


def _read_all_remaining_pages(in_file) -> list[OggPage]:
    pages: list[OggPage] = []
    while OggPage.seek_to_page_header(in_file):
        pages.append(OggPage(in_file))
    return pages


def _resize_pages(
    old_pages: list[OggPage],
    max_page_size: int,
    first_page_size: int,
    template_page: OggPage,
    last_granule: int = 0,
    start_no: int = 2,
    set_last_page_flag: bool = False,
) -> list[OggPage]:
    new_pages: list[OggPage] = []
    current_source_page = None
    page_no = start_no
    current_max_size = first_page_size
    new_page = OggPage.from_page(template_page)
    new_page.page_no = page_no

    while old_pages or current_source_page is not None:
        if current_source_page is None:
            current_source_page = old_pages.pop(0)

        packet_size = current_source_page.get_size_of_first_packet()
        segment_count = current_source_page.get_segment_count_of_first_packet()

        if (
            packet_size + segment_count + new_page.get_page_size() <= current_max_size
            and len(new_page.segments) + segment_count < 256
        ):
            for _ in range(segment_count):
                new_page.segments.append(current_source_page.segments.pop(0))
            if not current_source_page.segments:
                current_source_page = None
        else:
            new_page.pad(current_max_size)
            new_page.correct_values(last_granule)
            last_granule = new_page.granule_position
            new_pages.append(new_page)

            new_page = OggPage.from_page(template_page)
            page_no += 1
            new_page.page_no = page_no
            current_max_size = max_page_size

    if new_page.segments:
        if set_last_page_flag:
            new_page.page_type = 4
        new_page.pad(current_max_size)
        new_page.correct_values(last_granule)
        new_pages.append(new_page)

    return new_pages


def _write_taf_header(out_file, chapters: list[int], audio_id: int, sha1) -> None:
    current_pos = out_file.tell()
    audio_length = current_pos - TONIEFILE_FRAME_SIZE
    header_block = create_taf_header_block(
        sha1_hash=sha1.digest(),
        num_bytes=audio_length,
        audio_id=audio_id,
        track_page_nums=chapters,
    )
    out_file.seek(0)
    out_file.write(header_block)
    out_file.seek(current_pos)


def _write_pcm_wav(path: Path, pcm_data: bytes) -> None:
    with wave.open(str(path), "wb") as wav_file:
        wav_file.setnchannels(OPUS_CHANNELS)
        wav_file.setsampwidth(2)
        wav_file.setframerate(OPUS_SAMPLING_RATE)
        wav_file.writeframes(pcm_data)


def _encode_wav_to_opus(input_wav: Path, output_opus: Path, bitrate: int, vbr: bool = True) -> None:
    cmd = [
        "ffmpeg",
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-i",
        str(input_wav),
        "-c:a",
        "libopus",
        "-b:a",
        f"{bitrate}k",
        "-vbr",
        "on" if vbr else "off",
        "-application",
        "audio",
        "-frame_duration",
        "20",
        "-f",
        "opus",
        str(output_opus),
    ]
    try:
        result = subprocess.run(cmd, capture_output=True, text=True)
    except FileNotFoundError as exc:
        raise RuntimeError("FFmpeg nicht gefunden. Stelle sicher, dass `ffmpeg` im Runtime-Image verfuegbar ist.") from exc
    if result.returncode != 0:
        raise RuntimeError(f"FFmpeg encode error: {result.stderr.strip()[:500]}")


class TafEncoder:
    def __init__(self, output_path: str | Path, audio_id: int | None = None, bitrate: int = 96):
        self.output_path = Path(output_path)
        self.audio_id = audio_id if audio_id is not None else generate_audio_id()
        self.bitrate = bitrate
        self.sha1_hash: bytes = b""
        self.sha1_hash_hex: str = ""
        self._chapter_pcm: list[bytearray] = []
        self._opened = False

    def open(self):
        self._chapter_pcm = []
        self._opened = True

    def new_chapter(self):
        if not self._opened:
            raise RuntimeError("TafEncoder is not open")
        if len(self._chapter_pcm) >= TONIEFILE_MAX_CHAPTERS:
            raise ValueError(f"Maximum {TONIEFILE_MAX_CHAPTERS} chapters exceeded")
        self._chapter_pcm.append(bytearray())

    def encode(self, pcm_data: bytes):
        if not self._opened:
            raise RuntimeError("TafEncoder is not open")
        if not self._chapter_pcm:
            self.new_chapter()
        self._chapter_pcm[-1].extend(pcm_data)

    def _build_from_opus_files(self, opus_paths: list[Path]) -> None:
        sha1 = hashlib.sha1()
        template_page = None
        chapters: list[int] = []
        total_granule = 0
        next_page_no = 2

        with open(self.output_path, "wb") as out_file:
            out_file.write(b"\x00" * TONIEFILE_FRAME_SIZE)

            for index, opus_path in enumerate(opus_paths):
                with open(opus_path, "rb") as handle:
                    first_audio_page_size = TONIEFILE_FIRST_AUDIO_PAGE_SIZE if next_page_no == 2 else TONIEFILE_FRAME_SIZE

                    if next_page_no == 2:
                        _copy_first_and_second_page(handle, out_file, self.audio_id, sha1, self.bitrate, True)
                    else:
                        _skip_first_two_pages(handle)

                    pages = _read_all_remaining_pages(handle)
                    if not pages:
                        raise RuntimeError(f"No Opus audio pages found in {opus_path.name}")

                    if template_page is None:
                        template_page = OggPage.from_page(pages[0])
                        template_page.serial_no = self.audio_id

                    chapters.append(0 if next_page_no == 2 else next_page_no)
                    new_pages = _resize_pages(
                        pages,
                        TONIEFILE_FRAME_SIZE,
                        first_audio_page_size,
                        template_page,
                        total_granule,
                        next_page_no,
                        set_last_page_flag=index == len(opus_paths) - 1,
                    )

                    for page in new_pages:
                        page.write_page(out_file, sha1)

                    last_page = new_pages[-1]
                    total_granule = last_page.granule_position
                    next_page_no = last_page.page_no + 1

            self.sha1_hash = sha1.digest()
            self.sha1_hash_hex = self.sha1_hash.hex()
            _write_taf_header(out_file, chapters, self.audio_id, sha1)

    def close(self):
        if not self._opened:
            return

        if not self._chapter_pcm:
            raise RuntimeError("No chapter audio available for TAF build")

        with tempfile.TemporaryDirectory(prefix="tafforge-encoder-") as temp_dir_name:
            temp_dir = Path(temp_dir_name)
            opus_paths: list[Path] = []

            for index, pcm in enumerate(self._chapter_pcm, start=1):
                pcm_bytes = bytes(pcm) if pcm else b"\x00" * MIN_SILENCE_PCM_BYTES
                wav_path = temp_dir / f"chapter_{index:03d}.wav"
                opus_path = temp_dir / f"chapter_{index:03d}.opus"
                _write_pcm_wav(wav_path, pcm_bytes)
                _encode_wav_to_opus(wav_path, opus_path, self.bitrate, True)
                opus_paths.append(opus_path)

            self._build_from_opus_files(opus_paths)

        self._opened = False
        self._chapter_pcm = []

    def __enter__(self):
        self.open()
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        if self._opened:
            self.close()
