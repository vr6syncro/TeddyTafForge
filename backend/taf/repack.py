import math
import struct


def _build_crc_table() -> list[int]:
    table = []
    for i in range(256):
        value = i << 24
        for _ in range(8):
            if value & 0x80000000:
                value = ((value << 1) ^ 0x04C11DB7) & 0xFFFFFFFF
            else:
                value = (value << 1) & 0xFFFFFFFF
        table.append(value)
    return table


_CRC_TABLE = _build_crc_table()


def ogg_crc32(data: bytes) -> int:
    crc = 0
    for byte in data:
        crc = ((crc & 0x00FFFFFF) << 8) ^ _CRC_TABLE[((crc >> 24) ^ byte) & 0xFF]
    return crc


class OpusPacket:
    def __init__(
        self,
        filehandle=None,
        size: int = -1,
        last_size: int = -1,
        dont_parse_info: bool = False,
    ) -> None:
        self.size = 0
        self.data = b""
        self.spanning_packet = False
        self.first_packet = True
        self.config_value = None
        self.stereo = None
        self.framepacking = None
        self.padding = 0
        self.frame_count = None
        self.frame_size = None
        self.granule = 0

        if filehandle is None:
            return

        self.size = size
        self.data = filehandle.read(size)
        self.spanning_packet = size == 255
        self.first_packet = last_size != 255

        if self.first_packet and not dont_parse_info:
            self._parse_segment_info()

    def _parse_segment_info(self) -> None:
        byte = self.data[0]
        self.config_value = byte >> 3
        self.stereo = (byte & 0x04) >> 2
        self.framepacking = byte & 0x03
        self.padding = self.get_padding()
        self.frame_count = self.get_frame_count()
        self.frame_size = self.get_frame_size_ms()
        self.granule = int(self.frame_size * self.frame_count * 48)

    def get_frame_count(self) -> int:
        if self.framepacking == 0:
            return 1
        if self.framepacking == 1:
            return 2
        if self.framepacking == 2:
            return 2
        return self.data[1] & 0x3F

    def get_padding(self) -> int:
        if self.framepacking != 3:
            return 0
        if len(self.data) < 3:
            return 0
        flags = self.data[1]
        if ((flags >> 6) & 0x01) == 0:
            return 0
        total = self.data[2]
        idx = 3
        while idx < len(self.data) and self.data[idx - 1] == 255:
            total += self.data[idx] - 1
            idx += 1
        return total

    def get_frame_size_ms(self) -> float:
        mapping = {
            16: 2.5, 20: 2.5, 24: 2.5, 28: 2.5,
            17: 5.0, 21: 5.0, 25: 5.0, 29: 5.0,
            18: 10.0, 22: 10.0, 26: 10.0, 30: 10.0,
            19: 20.0, 23: 20.0, 27: 20.0, 31: 20.0,
        }
        if self.config_value not in mapping:
            raise RuntimeError(
                f"Unsupported Opus config value {self.config_value}; Toniebox requires CELT-only packets"
            )
        return mapping[self.config_value]

    def convert_to_code3(self) -> None:
        if self.framepacking == 3:
            return
        toc = self.data[0] | 0x03
        frame_count = self.frame_count or 1
        if self.framepacking == 2:
            frame_count |= 0x80
        self.data = bytes([toc, frame_count]) + self.data[1:]
        self.framepacking = 3

    def set_padding(self, count: int) -> None:
        if self.framepacking != 3:
            raise AssertionError("Only code 3 packets can contain padding")
        pad_field_end = 2
        existing_padding = 0
        if self.padding:
            existing_padding = self.padding
            current = self.data[2]
            pad_field_end = 3
            while current == 255 and pad_field_end < len(self.data):
                current = self.data[pad_field_end]
                pad_field_end += 1

        frame_count_byte = self.data[1] | 0x40
        pad_count_data = bytearray()
        value = existing_padding + count
        while value > 254:
            pad_count_data.append(0xFF)
            value -= 254
        pad_count_data.append(value)

        self.data = (
            self.data[:1]
            + bytes([frame_count_byte])
            + bytes(pad_count_data)
            + self.data[pad_field_end:]
        )
        self.padding = existing_padding + count

    def write(self, filehandle) -> None:
        if self.data:
            filehandle.write(self.data)


class OggPage:
    def __init__(self, filehandle=None) -> None:
        self.version = 0
        self.page_type = 0
        self.granule_position = 0
        self.serial_no = 0
        self.page_no = 0
        self.checksum = 0
        self.segment_count = 0
        self.segments: list[OpusPacket] = []

        if filehandle is None:
            return

        header = filehandle.read(27)
        if len(header) != 27 or header[:4] != b"OggS":
            raise RuntimeError("Invalid OGG page header")

        (
            self.version,
            self.page_type,
            self.granule_position,
            self.serial_no,
            self.page_no,
            self.checksum,
            self.segment_count,
        ) = struct.unpack("<BBQLLLB", header[4:27])

        lacing = filehandle.read(self.segment_count)
        last_size = -1
        dont_parse_info = self.page_no in (0, 1)
        for length in lacing:
            packet = OpusPacket(filehandle, length, last_size, dont_parse_info)
            self.segments.append(packet)
            last_size = length

        if self.segments and self.segments[-1].spanning_packet:
            raise RuntimeError("Opus packet spanning pages is not supported")

    @staticmethod
    def from_page(other: "OggPage") -> "OggPage":
        page = OggPage()
        page.version = other.version
        page.page_type = other.page_type
        page.granule_position = other.granule_position
        page.serial_no = other.serial_no
        page.page_no = other.page_no
        page.checksum = 0
        page.segment_count = 0
        page.segments = []
        return page

    @staticmethod
    def seek_to_page_header(filehandle) -> bool:
        start = filehandle.tell()
        filehandle.seek(0, 2)
        size = filehandle.tell()
        filehandle.seek(start)

        probe = filehandle.read(5)
        while probe and filehandle.tell() + 5 < size:
            if probe == b"OggS\x00":
                filehandle.seek(-5, 1)
                return True
            filehandle.seek(-4, 1)
            probe = filehandle.read(5)
        return False

    def calc_checksum(self) -> int:
        header = b"OggS" + struct.pack(
            "<BBQLLLB",
            self.version,
            self.page_type,
            self.granule_position,
            self.serial_no,
            self.page_no,
            0,
            self.segment_count,
        )
        lacing = bytes(segment.size for segment in self.segments)
        body = b"".join(segment.data for segment in self.segments)
        return ogg_crc32(header + lacing + body)

    def correct_values(self, last_granule: int) -> None:
        if len(self.segments) > 255:
            raise RuntimeError(f"Too many segments in page: {len(self.segments)}")

        granule = 0
        if self.page_no not in (0, 1):
            for segment in self.segments:
                if segment.first_packet:
                    granule += segment.granule

        self.granule_position = last_granule + granule
        self.segment_count = len(self.segments)
        self.checksum = self.calc_checksum()

    def get_page_size(self) -> int:
        return 27 + len(self.segments) + sum(len(segment.data) for segment in self.segments)

    def get_size_of_first_packet(self) -> int:
        if not self.segments:
            return 0
        size = self.segments[0].size
        idx = 1
        while idx < len(self.segments) and self.segments[idx - 1].size == 255:
            size += self.segments[idx].size
            idx += 1
        return size

    def get_segment_count_of_first_packet(self) -> int:
        if not self.segments:
            return 0
        count = 1
        while count < len(self.segments) and self.segments[count - 1].size == 255:
            count += 1
        return count

    def get_segment_count_of_packet_at(self, seg_start: int) -> int:
        seg_end = seg_start + 1
        while seg_end < len(self.segments) and not self.segments[seg_end].first_packet:
            seg_end += 1
        return seg_end - seg_start

    def get_packet_size(self, seg_start: int) -> int:
        size = len(self.segments[seg_start].data)
        idx = seg_start + 1
        while idx < len(self.segments) and not self.segments[idx].first_packet:
            size += self.segments[idx].size
            idx += 1
        return size

    def insert_empty_segment(
        self,
        index_after: int,
        spanning_packet: bool = False,
        first_packet: bool = False,
    ) -> None:
        segment = OpusPacket()
        segment.first_packet = first_packet
        segment.spanning_packet = spanning_packet
        segment.size = 0
        segment.data = b""
        self.segments.insert(index_after + 1, segment)

    def _redistribute_packet_data(self, seg_start: int, pad_count: int) -> None:
        seg_count = self.get_segment_count_of_packet_at(seg_start)
        full_data = b"".join(self.segments[seg_start + i].data for i in range(seg_count))
        full_data += bytes(pad_count)

        if len(full_data) < 255:
            self.segments[seg_start].size = len(full_data)
            self.segments[seg_start].data = full_data
            return

        needed_seg_count = math.ceil(len(full_data) / 255)
        if len(full_data) % 255 == 0:
            needed_seg_count += 1

        for offset in range(needed_seg_count - seg_count):
            self.insert_empty_segment(
                seg_start + seg_count + offset,
                spanning_packet=offset != (needed_seg_count - seg_count - 1),
            )

        for idx in range(needed_seg_count):
            chunk = full_data[:255]
            self.segments[seg_start + idx].data = chunk
            self.segments[seg_start + idx].size = len(chunk)
            full_data = full_data[255:]

        if full_data:
            raise RuntimeError("Failed to redistribute Opus packet data")

    def _convert_packet_and_pad(self, seg_start: int, pad: bool = False, count: int = 0) -> None:
        packet = self.segments[seg_start]
        if not packet.first_packet:
            raise AssertionError("Segment is not the start of a packet")
        packet.convert_to_code3()
        if pad:
            packet.set_padding(count)
        self._redistribute_packet_data(seg_start, count)

    def _calc_padding_value(self, seg_start: int, bytes_needed: int) -> int:
        if bytes_needed < 0:
            raise AssertionError("Page is already larger than target size")
        if bytes_needed == 0:
            return -10

        seg_count = self.get_segment_count_of_packet_at(seg_start)
        size_of_last_segment = self.segments[seg_start + seg_count - 1].size
        convert_needed = self.segments[seg_start].framepacking != 3

        if (bytes_needed + size_of_last_segment) % 255 == 0:
            return -20
        if bytes_needed == 1:
            return -30 if convert_needed else 0

        new_segments_needed = 0
        if bytes_needed + size_of_last_segment >= 255:
            remaining = bytes_needed + size_of_last_segment - 255
            while remaining >= 0:
                remaining -= 256
                new_segments_needed += 1

        if new_segments_needed + len(self.segments) > 255:
            return -40

        if (bytes_needed + size_of_last_segment) % 255 == (new_segments_needed - 1):
            return -20

        packet_bytes_needed = bytes_needed - new_segments_needed
        if packet_bytes_needed == 1:
            return -30 if convert_needed else 0

        if convert_needed:
            packet_bytes_needed -= 1

        packet_bytes_needed -= 1
        size_of_padding_count_data = max(1, math.ceil(packet_bytes_needed / 254))
        check_size = math.ceil((packet_bytes_needed - size_of_padding_count_data + 1) / 254)
        if check_size != size_of_padding_count_data:
            return -20
        return packet_bytes_needed - size_of_padding_count_data + 1

    def _pad_one_byte(self) -> None:
        idx = 0
        while idx < len(self.segments):
            segment = self.segments[idx]
            if (
                segment.first_packet
                and not segment.padding
                and self.get_packet_size(idx) % 255 < 254
            ):
                if segment.framepacking == 3:
                    self._convert_packet_and_pad(idx, True, 0)
                else:
                    self._convert_packet_and_pad(idx)
                return
            idx += 1
        raise RuntimeError("Page cannot be padded by a single byte")

    def pad(self, pad_to: int, idx_offset: int = -1) -> None:
        idx = len(self.segments) - 1 if idx_offset == -1 else idx_offset
        while idx >= 0 and not self.segments[idx].first_packet:
            idx -= 1
        if idx < 0:
            raise RuntimeError("Could not find packet start for padding")

        pad_count = pad_to - self.get_page_size()
        actual_padding = self._calc_padding_value(idx, pad_count)

        if actual_padding == -10:
            return
        if actual_padding == -30:
            self._convert_packet_and_pad(idx)
            return
        if actual_padding == -20:
            self._pad_one_byte()
            self.pad(pad_to)
            return
        if actual_padding == -40:
            self.pad(pad_to - (pad_count // 2), idx - 1)
            self.pad(pad_to)
            return

        self._convert_packet_and_pad(idx, True, actual_padding)
        final_size = self.get_page_size()
        if final_size != pad_to and final_size < pad_to and idx > 0:
            self.pad(pad_to, idx - 1)
            final_size = self.get_page_size()

        if final_size != pad_to:
            raise AssertionError(
                f"Page padding mismatch: expected {pad_to}, got {final_size}"
            )

    def write_page(self, filehandle, sha1=None) -> None:
        header = b"OggS" + struct.pack(
            "<BBQLLLB",
            self.version,
            self.page_type,
            self.granule_position,
            self.serial_no,
            self.page_no,
            self.checksum,
            self.segment_count,
        )
        lacing = bytes(segment.size for segment in self.segments)
        if sha1 is not None:
            sha1.update(header)
            sha1.update(lacing)
        filehandle.write(header)
        filehandle.write(lacing)
        for segment in self.segments:
            if sha1 is not None:
                sha1.update(segment.data)
            segment.write(filehandle)
