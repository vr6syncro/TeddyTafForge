"""TAF Protobuf header serialization.

The TAF header is exactly 4096 bytes:
  - 4 bytes: protobuf data length (big-endian uint32)
  - N bytes: protobuf-encoded TonieboxAudioFileHeader
  - Padding: zeros to fill 4096 bytes

The protobuf message uses a `_fill` field (field 5) to pad the
serialized data to exactly 4092 bytes (4096 - 4 length prefix).
"""

import struct

TONIEFILE_FRAME_SIZE = 4096


def _encode_varint(value: int) -> bytes:
    result = bytearray()
    while value > 0x7F:
        result.append((value & 0x7F) | 0x80)
        value >>= 7
    result.append(value & 0x7F)
    return bytes(result)


def _encode_field_varint(field_number: int, value: int) -> bytes:
    tag = _encode_varint((field_number << 3) | 0)
    return tag + _encode_varint(value)


def _encode_field_bytes(field_number: int, data: bytes) -> bytes:
    tag = _encode_varint((field_number << 3) | 2)
    return tag + _encode_varint(len(data)) + data


def _encode_packed_uint32(field_number: int, values: list[int]) -> bytes:
    if not values:
        return b""
    packed = b"".join(_encode_varint(v) for v in values)
    return _encode_field_bytes(field_number, packed)


def _encode_taf_proto(
    sha1_hash: bytes,
    num_bytes: int,
    audio_id: int,
    track_page_nums: list[int],
    fill_size: int,
) -> bytes:
    data = b""
    data += _encode_field_bytes(1, sha1_hash)
    data += _encode_field_varint(2, num_bytes)
    data += _encode_field_varint(3, audio_id)
    if track_page_nums:
        data += _encode_packed_uint32(4, track_page_nums)
    data += _encode_field_bytes(5, b"\x00" * fill_size)
    return data


def create_taf_header_block(
    sha1_hash: bytes,
    num_bytes: int,
    audio_id: int,
    track_page_nums: list[int],
) -> bytes:
    """Create the complete 4096-byte TAF header block.

    Mirrors toniefile_header() + toniefile_write_header() from toniefile.c.
    """
    proto_frame_size = TONIEFILE_FRAME_SIZE - 4  # 4092

    # Pass 1: encode with large fill to measure overhead
    fill_size = proto_frame_size
    data = _encode_taf_proto(sha1_hash, num_bytes, audio_id, track_page_nums, fill_size)
    data_len = len(data)

    # Pass 2: adjust fill so total == proto_frame_size
    fill_size = fill_size + (proto_frame_size - data_len)
    data = _encode_taf_proto(sha1_hash, num_bytes, audio_id, track_page_nums, fill_size)
    data_len = len(data)

    # Pass 3: handle varint size edge case
    if data_len == proto_frame_size + 1:
        fill_size -= 1
        data = _encode_taf_proto(sha1_hash, num_bytes, audio_id, track_page_nums, fill_size)
        data_len = len(data)

    if data_len not in (proto_frame_size, proto_frame_size - 1):
        raise ValueError(f"TAF header proto size {data_len} != {proto_frame_size}")

    # 4-byte big-endian length prefix + protobuf data + zero padding
    block = struct.pack(">I", data_len) + data
    block += b"\x00" * (TONIEFILE_FRAME_SIZE - len(block))

    return block
