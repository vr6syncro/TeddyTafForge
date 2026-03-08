"""TAF encoder: Opus encoding + OGG packaging with 4K block alignment.

Mirrors toniefile.c from TeddyCloud. Uses libopus via ctypes for encoding
and implements OGG page framing manually for precise 4K block control.

Requires libopus (libopus.so.0 / libopus0 package) at runtime.
"""

import ctypes
import ctypes.util
import hashlib
import struct
import sys
import time
from pathlib import Path

from .header import create_taf_header_block

# === Constants (matching toniefile.h) ===

TONIEFILE_FRAME_SIZE = 4096
OPUS_FRAME_SIZE = 2880  # 60ms @ 48kHz
OPUS_CHANNELS = 2
OPUS_SAMPLING_RATE = 48000
OGG_HEADER_LENGTH = 27
OPUS_PACKET_PAD = 64
OPUS_PACKET_MINSIZE = 64
TONIEFILE_PAD_END = 96
TONIEFILE_MAX_CHAPTERS = 100
COMMENT_DATA_SIZE = 0x1B4  # 436 bytes

# Opus constants
OPUS_OK = 0
OPUS_APPLICATION_AUDIO = 2049
OPUS_SET_BITRATE_REQUEST = 4002
OPUS_SET_VBR_REQUEST = 4006
OPUS_SET_EXPERT_FRAME_DURATION_REQUEST = 4040
OPUS_FRAMESIZE_60_MS = 5006


# === Load libopus ===

def _load_opus():
    candidates = []
    lib_name = ctypes.util.find_library("opus")
    if lib_name:
        candidates.append(lib_name)
    if sys.platform == "linux":
        candidates.extend(["libopus.so.0", "libopus.so"])
    elif sys.platform == "darwin":
        candidates.extend(["libopus.0.dylib", "libopus.dylib"])
    elif sys.platform == "win32":
        candidates.extend(["opus.dll", "libopus-0.dll"])
    for name in candidates:
        try:
            return ctypes.cdll.LoadLibrary(name)
        except OSError:
            continue
    raise ImportError("libopus not found. Install libopus0 (apt-get install libopus0).")


_opus = None


def _get_opus():
    """Lazy-load libopus on first use."""
    global _opus
    if _opus is not None:
        return _opus
    _opus = _load_opus()

    _opus.opus_encoder_create.argtypes = [
        ctypes.c_int32, ctypes.c_int, ctypes.c_int, ctypes.POINTER(ctypes.c_int),
    ]
    _opus.opus_encoder_create.restype = ctypes.c_void_p

    _opus.opus_encode.argtypes = [
        ctypes.c_void_p, ctypes.POINTER(ctypes.c_int16),
        ctypes.c_int, ctypes.POINTER(ctypes.c_ubyte), ctypes.c_int32,
    ]
    _opus.opus_encode.restype = ctypes.c_int32

    _opus.opus_encoder_ctl.restype = ctypes.c_int
    _opus.opus_encoder_destroy.argtypes = [ctypes.c_void_p]
    _opus.opus_encoder_destroy.restype = None

    _opus.opus_packet_pad.argtypes = [
        ctypes.POINTER(ctypes.c_ubyte), ctypes.c_int32, ctypes.c_int32,
    ]
    _opus.opus_packet_pad.restype = ctypes.c_int

    _opus.opus_strerror.argtypes = [ctypes.c_int]
    _opus.opus_strerror.restype = ctypes.c_char_p

    return _opus


def _encoder_ctl(enc, request, value):
    opus = _get_opus()
    opus.opus_encoder_ctl.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_int]
    return opus.opus_encoder_ctl(enc, request, value)


# === OGG CRC-32 ===

def _build_ogg_crc_table():
    table = []
    for i in range(256):
        r = i << 24
        for _ in range(8):
            r = ((r << 1) ^ 0x04C11DB7) & 0xFFFFFFFF if r & 0x80000000 else (r << 1) & 0xFFFFFFFF
        table.append(r)
    return table


_OGG_CRC_TABLE = _build_ogg_crc_table()


def _ogg_crc32(data: bytes | bytearray) -> int:
    crc = 0
    for byte in data:
        crc = ((crc << 8) ^ _OGG_CRC_TABLE[((crc >> 24) ^ byte) & 0xFF]) & 0xFFFFFFFF
    return crc


# === OGG Stream State ===

class _OggStream:
    """Minimal OGG stream state for page construction."""

    def __init__(self, serial: int):
        self.serial = serial
        self.pageno = 0
        self.lacing_values: list[int] = []
        self.body_data = bytearray()
        self._granule = 0

    @property
    def lacing_fill(self) -> int:
        return len(self.lacing_values)

    @property
    def body_fill(self) -> int:
        return len(self.body_data)

    def packetin(self, data: bytes, granulepos: int, bos: bool = False, eos: bool = False):
        self.body_data.extend(data)
        plen = len(data)
        while plen >= 255:
            self.lacing_values.append(255)
            plen -= 255
        self.lacing_values.append(plen)
        self._granule = granulepos
        self._bos = bos
        self._eos = eos

    def flush(self) -> bytes | None:
        if not self.lacing_values:
            return None

        # OGG page segment table uses 1 byte count (0..255 segments).
        # Emit at most 255 lacing values per page and prefer packet boundary.
        total_segments = len(self.lacing_values)
        n_segments = min(255, total_segments)
        if total_segments > 255 and self.lacing_values[n_segments - 1] == 255:
            while n_segments > 1 and self.lacing_values[n_segments - 1] == 255:
                n_segments -= 1

        page_lacing = self.lacing_values[:n_segments]
        body_len = sum(page_lacing)
        page_body = bytes(self.body_data[:body_len])

        header_type = 0
        if getattr(self, "_bos", False):
            header_type |= 0x02
        is_last_chunk = n_segments == total_segments
        if getattr(self, "_eos", False) and is_last_chunk:
            header_type |= 0x04

        header = struct.pack(
            "<4sBBqIIIB",
            b"OggS", 0, header_type,
            self._granule, self.serial, self.pageno, 0, n_segments,
        )
        header += bytes(page_lacing)

        page = bytearray(header + page_body)
        crc = _ogg_crc32(page)
        struct.pack_into("<I", page, 22, crc)

        del self.lacing_values[:n_segments]
        del self.body_data[:body_len]
        self.pageno += 1
        self._bos = False

        return bytes(page)


# === OpusHead + OpusTags ===

def _build_opus_head() -> bytes:
    return struct.pack(
        "<8sBBHIhB",
        b"OpusHead",
        1,                    # version
        OPUS_CHANNELS,        # channels
        0x0138,               # pre-skip (312)
        OPUS_SAMPLING_RATE,   # sample rate
        0,                    # output gain
        0,                    # channel mapping family
    )


def _append_opus_comment(buf: bytearray, pos: int, comment: bytes) -> int:
    struct.pack_into("<I", buf, pos, len(comment))
    pos += 4
    buf[pos:pos + len(comment)] = comment
    return pos + len(comment)


def _build_opus_tags(bitrate: int, vbr: bool = True) -> bytes:
    """Build OpusTags comment packet, padded to exactly 436 bytes."""
    buf = bytearray(COMMENT_DATA_SIZE)
    buf[:8] = b"OpusTags"
    pos = 8

    vendor = b"TeddyTafForge"
    pos = _append_opus_comment(buf, pos, vendor)

    comments = [
        b"version=dev",
        b"encoder=libopus (via ctypes)",
        f"encoder_options=--bitrate {bitrate} {'--vbr' if vbr else '--cbr'}".encode("ascii"),
    ]
    struct.pack_into("<I", buf, pos, len(comments))
    pos += 4

    for comment in comments:
        pos = _append_opus_comment(buf, pos, comment)

    # Trailing padding comment: "pad=..."
    remain = COMMENT_DATA_SIZE - pos - 4
    struct.pack_into("<I", buf, pos, remain)
    pos += 4
    buf[pos:pos + 4] = b"pad="

    return bytes(buf)


# === TAF Encoder ===

TEDDY_BENCH_AUDIO_ID_DEDUCT = 0x50000000


def generate_audio_id() -> int:
    """Generate audio_id as Unix-Timestamp minus TEDDY_BENCH_AUDIO_ID_DEDUCT."""
    return int(time.time()) - TEDDY_BENCH_AUDIO_ID_DEDUCT


class TafEncoder:
    """Encodes PCM audio to a TAF file with proper 4K block alignment.

    Usage:
        enc = TafEncoder("output.taf", bitrate=96)
        enc.open()
        enc.new_chapter()
        enc.encode(pcm_bytes_chapter1)
        enc.new_chapter()
        enc.encode(pcm_bytes_chapter2)
        enc.close()
        sha1_hex = enc.sha1_hash_hex  # available after close()
    """

    def __init__(self, output_path: str | Path, audio_id: int | None = None, bitrate: int = 96):
        self.output_path = Path(output_path)
        self.audio_id = audio_id if audio_id is not None else generate_audio_id()
        self.bitrate = bitrate
        self.sha1_hash: bytes = b""
        self.sha1_hash_hex: str = ""

        self._file = None
        self._sha1 = hashlib.sha1()
        self._file_pos = 0
        self._audio_length = 0
        self._track_page_nums: list[int] = []
        self._taf_block_num = 0

        # Opus
        self._enc = None
        self._audio_frame = (ctypes.c_int16 * (OPUS_CHANNELS * OPUS_FRAME_SIZE))()
        self._audio_frame_used = 0

        # OGG
        self._ogg = _OggStream(self.audio_id)
        self._ogg_granule_position = 0
        self._ogg_packet_count = 0

    def open(self):
        """Open TAF file and write initial header + OGG setup pages."""
        self._file = open(self.output_path, "wb")

        # Write placeholder header (will be overwritten on close)
        self._file.write(b"\x00" * TONIEFILE_FRAME_SIZE)

        # Init Opus encoder
        err = ctypes.c_int(0)
        opus = _get_opus()
        self._enc = opus.opus_encoder_create(
            OPUS_SAMPLING_RATE, OPUS_CHANNELS, OPUS_APPLICATION_AUDIO, ctypes.byref(err),
        )
        if err.value != OPUS_OK:
            raise RuntimeError(f"opus_encoder_create failed: {opus.opus_strerror(err.value)}")

        _encoder_ctl(self._enc, OPUS_SET_BITRATE_REQUEST, self.bitrate * 1000)
        _encoder_ctl(self._enc, OPUS_SET_VBR_REQUEST, 1)
        _encoder_ctl(self._enc, OPUS_SET_EXPERT_FRAME_DURATION_REQUEST, OPUS_FRAMESIZE_60_MS)

        # Write OpusHead as BOS page (separate, like toniefile.c)
        head = _build_opus_head()
        self._ogg.packetin(head, 0, bos=True)
        self._ogg_packet_count += 1
        page = self._ogg.flush()
        if page:
            self._write_audio(page)

        # Write OpusTags as separate page (like toniefile.c)
        tags = _build_opus_tags(self.bitrate, vbr=True)
        self._ogg.packetin(tags, 0)
        self._ogg_packet_count += 1
        page = self._ogg.flush()
        if page:
            self._write_audio(page)

    def new_chapter(self):
        """Mark the current position as start of a new chapter."""
        if len(self._track_page_nums) >= TONIEFILE_MAX_CHAPTERS:
            raise ValueError(f"Maximum {TONIEFILE_MAX_CHAPTERS} chapters exceeded")
        # For chapters after the first: flush pending OGG data and align to block
        # boundary before recording the chapter offset. Without this, the offset
        # points to the last page of the *previous* chapter instead of the first
        # page of the new one (off-by-one bug).
        if self._track_page_nums:
            self._flush_ogg_pages()
            if self._file_pos % TONIEFILE_FRAME_SIZE != 0:
                self._encode_chapter_fill()
        self._track_page_nums.append(self._taf_block_num)

    def encode(self, pcm_data: bytes):
        """Encode raw PCM data (int16 LE, interleaved stereo, 48kHz).

        Args:
            pcm_data: Raw PCM bytes. Length must be a multiple of 4 (2 channels * 2 bytes).
        """
        total_samples = len(pcm_data) // (2 * OPUS_CHANNELS)
        sample_buf = (ctypes.c_int16 * (total_samples * OPUS_CHANNELS)).from_buffer_copy(pcm_data)
        samples_processed = 0

        output_frame = (ctypes.c_ubyte * TONIEFILE_FRAME_SIZE)()

        while samples_processed < total_samples:
            # Fill audio frame buffer
            samples_needed = OPUS_FRAME_SIZE - self._audio_frame_used
            samples_available = total_samples - samples_processed
            samples_to_copy = min(samples_needed, samples_available)

            src_offset = samples_processed * OPUS_CHANNELS
            dst_offset = self._audio_frame_used * OPUS_CHANNELS
            ctypes.memmove(
                ctypes.byref(self._audio_frame, dst_offset * 2),
                ctypes.byref(sample_buf, src_offset * 2),
                samples_to_copy * OPUS_CHANNELS * 2,
            )
            self._audio_frame_used += samples_to_copy
            samples_processed += samples_to_copy

            # Frame full -> encode
            if self._audio_frame_used >= OPUS_FRAME_SIZE:
                self._encode_frame(output_frame)
                self._audio_frame_used = 0

    def _encode_frame(self, output_frame, eos: bool = False):
        """Encode one Opus frame with 4K block alignment."""
        # If the current block tail is too small for a valid packet, flush or fill
        # and retry. 3 iterations: flush pending data, silence-fill tail, retry encode.
        for _ in range(3):
            page_used = (
                (self._file_pos % TONIEFILE_FRAME_SIZE)
                + OGG_HEADER_LENGTH
                + self._ogg.lacing_fill
                + self._ogg.body_fill
            )
            page_remain = TONIEFILE_FRAME_SIZE - page_used

            # Convert page space to max opus packet size
            frame_payload = (page_remain // 256) * 255 + (page_remain % 256) - 1

            # Handle segment size edge case
            reconstructed = (frame_payload // 255) + 1 + frame_payload
            if page_remain != reconstructed and frame_payload > OPUS_PACKET_MINSIZE:
                frame_payload -= OPUS_PACKET_MINSIZE

            if frame_payload >= OPUS_PACKET_MINSIZE - 1:
                break

            flushed = self._flush_ogg_pages()
            if not flushed:
                self._silence_fill_tail()
        else:
            raise RuntimeError(
                f"Not enough space in block: payload={frame_payload}, remain={page_remain}"
            )

        # Encode
        opus = _get_opus()
        frame_len = opus.opus_encode(
            self._enc, self._audio_frame, OPUS_FRAME_SIZE,
            output_frame, frame_payload,
        )
        if frame_len <= 0:
            raise RuntimeError(f"opus_encode failed: {opus.opus_strerror(frame_len)}")

        # Pad if close to target size
        if frame_payload - frame_len < OPUS_PACKET_PAD:
            ret = opus.opus_packet_pad(output_frame, frame_len, frame_payload)
            if ret < 0:
                raise RuntimeError(f"opus_packet_pad failed: {opus.opus_strerror(ret)}")
            frame_len = frame_payload

        self._ogg_granule_position += OPUS_FRAME_SIZE

        # Feed to OGG stream
        packet_data = bytes(output_frame[:frame_len])
        self._ogg.packetin(packet_data, self._ogg_granule_position, eos=eos)
        self._ogg_packet_count += 1

        # Check if block is full -> flush
        page_used = (
            (self._file_pos % TONIEFILE_FRAME_SIZE)
            + OGG_HEADER_LENGTH
            + self._ogg.lacing_fill
            + self._ogg.body_fill
        )
        page_remain = TONIEFILE_FRAME_SIZE - page_used

        if page_remain < TONIEFILE_PAD_END:
            # Kleine Restbereiche am Blockende sind zulaessig.
            # Wichtig ist nur, dass keine OGG-Page ueber die 4K-Grenze geht.
            self._flush_ogg_pages()

    def _flush_ogg_pages(self) -> bool:
        flushed = False
        while True:
            page = self._ogg.flush()
            if page is None:
                break
            flushed = True
            prev = self._file_pos
            self._write_audio(page)

            if (prev // TONIEFILE_FRAME_SIZE) != (self._file_pos // TONIEFILE_FRAME_SIZE):
                self._taf_block_num += 1
                if self._file_pos % TONIEFILE_FRAME_SIZE:
                    raise RuntimeError(f"Block alignment mismatch at 0x{self._file_pos:08X}")
        return flushed

    def _pad_to_block_boundary(self) -> bool:
        """Pad with zero bytes until next 4K block boundary if needed.

        This is required for rare tails where no valid packet can start in the
        remaining block bytes and there is nothing pending to flush.
        """
        remain = TONIEFILE_FRAME_SIZE - (self._file_pos % TONIEFILE_FRAME_SIZE)
        if remain == TONIEFILE_FRAME_SIZE:
            return False
        self._write_audio(b"\x00" * remain)
        self._taf_block_num += 1
        return True

    def _encode_chapter_fill(self):
        """Fill remaining block space at chapter boundaries via silence fill."""
        self._silence_fill_tail()

    def _silence_fill_tail(self):
        """Fill the remaining block space with a silence Opus frame.

        Used both at chapter boundaries (_encode_chapter_fill) and within chapters
        (_encode_frame) when the block tail is too small for the next real audio frame.
        Avoids raw zero-padding which breaks Toniebox OGG sync at any position.

        The Opus packet is sized so the resulting OGG page fills the block exactly:
          frame_payload = (page_remain // 256) * 255 + (page_remain % 256) - 1

        Edge case when page_remain % 256 == 0: the standard formula produces a page
        1 byte short (26 + N*256 instead of 27 + N*256). Fix: reduce page_remain by 29
        so the first frame fills (remain-29) bytes, then recurse for the trailing 29 bytes.
        Proof: adjusted page_remain = N*256-29, % 256 = 227, formula correct.

        Falls back to zero-padding only for tails < 29 bytes (smaller than the
        minimum possible OGG page: 27 header + 1 segment + 1 body byte).
        """
        remain = TONIEFILE_FRAME_SIZE - (self._file_pos % TONIEFILE_FRAME_SIZE)
        if remain == TONIEFILE_FRAME_SIZE:
            return  # Already block-aligned

        # Minimum valid OGG page = 27 + 1 segment + 1 body byte = 29 bytes
        if remain < 29:
            self._pad_to_block_boundary()
            return

        page_remain = remain - OGG_HEADER_LENGTH

        # Edge case: page_remain % 256 == 0 → formula gives OGG page 1 byte short.
        # Shrink page_remain by 29 so first frame fills (remain-29) bytes; recurse
        # to handle the trailing 29 bytes ((29-27)%256=2, formula correct there).
        if page_remain % 256 == 0:
            page_remain -= 29

        frame_payload = (page_remain // 256) * 255 + (page_remain % 256) - 1
        frame_payload = max(1, frame_payload)

        opus = _get_opus()
        output_frame = (ctypes.c_ubyte * TONIEFILE_FRAME_SIZE)()
        silence = (ctypes.c_int16 * (OPUS_FRAME_SIZE * OPUS_CHANNELS))()

        frame_len = opus.opus_encode(
            self._enc, silence, OPUS_FRAME_SIZE, output_frame, frame_payload,
        )
        if frame_len <= 0:
            self._pad_to_block_boundary()
            return

        # Always pad to exact target so the OGG page fills the block precisely
        if frame_len < frame_payload:
            ret = opus.opus_packet_pad(output_frame, frame_len, frame_payload)
            if ret < 0:
                self._pad_to_block_boundary()
                return
            frame_len = frame_payload

        self._ogg_granule_position += OPUS_FRAME_SIZE
        packet_data = bytes(output_frame[:frame_len])
        self._ogg.packetin(packet_data, self._ogg_granule_position)
        self._ogg_packet_count += 1
        self._flush_ogg_pages()

        # Recurse if bytes remain (happens when the edge-case split emits 2 frames)
        new_remain = TONIEFILE_FRAME_SIZE - (self._file_pos % TONIEFILE_FRAME_SIZE)
        if 0 < new_remain < TONIEFILE_FRAME_SIZE:
            self._silence_fill_tail()

    def _write_audio(self, data: bytes):
        """Write audio data, update SHA1 and position."""
        self._file.write(data)
        self._sha1.update(data)
        self._file_pos += len(data)
        self._audio_length += len(data)

    def close(self):
        """Finalize TAF: flush remaining audio, compute SHA1, write header.

        After close(), sha1_hash and sha1_hash_hex are available.
        """
        # Encode remaining samples (zero-pad to full frame, like toniefile.c).
        # Pass eos=True so the last audio packet's OGG page carries the EOS flag.
        if self._audio_frame_used > 0 and self._enc:
            output_frame = (ctypes.c_ubyte * TONIEFILE_FRAME_SIZE)()
            remaining = OPUS_FRAME_SIZE - self._audio_frame_used
            dst_offset = self._audio_frame_used * OPUS_CHANNELS
            ctypes.memset(
                ctypes.byref(self._audio_frame, dst_offset * 2),
                0,
                remaining * OPUS_CHANNELS * 2,
            )
            self._audio_frame_used = OPUS_FRAME_SIZE
            self._encode_frame(output_frame, eos=True)
            self._audio_frame_used = 0

        # Flush any remaining OGG data as final page with EOS flag.
        # This covers the rare case where the partial frame was flushed internally
        # by _encode_frame but lacing_fill still has pending data.
        if self._ogg.lacing_fill > 0 or self._ogg.body_fill > 0:
            self._ogg._eos = True  # Mark end of stream (EOS bit in OGG page header)
            page = self._ogg.flush()
            if page:
                self._write_audio(page)

        if self._enc:
            _get_opus().opus_encoder_destroy(self._enc)
            self._enc = None

        self.sha1_hash = self._sha1.digest()
        self.sha1_hash_hex = self.sha1_hash.hex()

        header_block = create_taf_header_block(
            sha1_hash=self.sha1_hash,
            num_bytes=self._audio_length,
            audio_id=self.audio_id,
            track_page_nums=self._track_page_nums,
        )

        self._file.seek(0)
        self._file.write(header_block)
        self._file.close()
        self._file = None

    def __enter__(self):
        self.open()
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        if self._file:
            self.close()
