import { describe, expect, it } from "vitest";
import { MAX_FILE_SIZE_BYTES, validateUploadedRecording } from "../upload-validation";

function wavBuffer(size = 100) {
  const buf = Buffer.alloc(size);
  buf.write("RIFF", 0, "ascii");
  buf.write("WAVE", 8, "ascii");
  return buf;
}

function mp3Buffer(size = 100) {
  const buf = Buffer.alloc(size);
  buf.write("ID3", 0, "ascii");
  return buf;
}

function mp4Buffer(size = 100) {
  const buf = Buffer.alloc(size);
  buf.write("ftyp", 4, "ascii");
  return buf;
}

function webmBuffer(size = 100) {
  const buf = Buffer.alloc(size);
  buf[0] = 0x1a;
  buf[1] = 0x45;
  buf[2] = 0xdf;
  buf[3] = 0xa3;
  return buf;
}

describe("validateUploadedRecording", () => {
  it("accepts a valid WAV file", () => {
    const result = validateUploadedRecording({ originalFilename: "meeting.wav", declaredMimeType: "audio/wav", buffer: wavBuffer() });
    expect(result.family).toBe("wav");
  });

  it("accepts a valid MP3 file", () => {
    const result = validateUploadedRecording({ originalFilename: "meeting.mp3", declaredMimeType: "audio/mpeg", buffer: mp3Buffer() });
    expect(result.family).toBe("mp3");
  });

  it("accepts a valid M4A file (shares mp4 container magic bytes)", () => {
    const result = validateUploadedRecording({ originalFilename: "meeting.m4a", declaredMimeType: "audio/mp4", buffer: mp4Buffer() });
    expect(result.family).toBe("m4a");
  });

  it("accepts a valid MP4 file", () => {
    const result = validateUploadedRecording({ originalFilename: "meeting.mp4", declaredMimeType: "video/mp4", buffer: mp4Buffer() });
    expect(result.family).toBe("mp4");
  });

  it("accepts a valid WEBM file", () => {
    const result = validateUploadedRecording({ originalFilename: "meeting.webm", declaredMimeType: "audio/webm", buffer: webmBuffer() });
    expect(result.family).toBe("webm");
  });

  it("rejects an unsupported extension", () => {
    expect(() => validateUploadedRecording({ originalFilename: "meeting.exe", declaredMimeType: "audio/mpeg", buffer: mp3Buffer() })).toThrow(
      expect.objectContaining({ code: "MEETING_INTELLIGENCE_FILE_UNSUPPORTED" })
    );
  });

  it("rejects an unsupported declared MIME type", () => {
    expect(() =>
      validateUploadedRecording({ originalFilename: "meeting.mp3", declaredMimeType: "application/x-executable", buffer: mp3Buffer() })
    ).toThrow(expect.objectContaining({ code: "MEETING_INTELLIGENCE_FILE_UNSUPPORTED" }));
  });

  it("rejects a file exceeding the maximum size", () => {
    const oversized = Buffer.concat([wavBuffer(), Buffer.alloc(MAX_FILE_SIZE_BYTES)]);
    expect(() => validateUploadedRecording({ originalFilename: "meeting.wav", declaredMimeType: "audio/wav", buffer: oversized })).toThrow(
      expect.objectContaining({ code: "MEETING_INTELLIGENCE_FILE_TOO_LARGE" })
    );
  });

  it("rejects an empty file", () => {
    expect(() => validateUploadedRecording({ originalFilename: "meeting.wav", declaredMimeType: "audio/wav", buffer: Buffer.alloc(0) })).toThrow(
      expect.objectContaining({ code: "MEETING_INTELLIGENCE_FILE_UNSUPPORTED" })
    );
  });

  it("rejects a mismatched extension/MIME type pair (.wav claimed as audio/mpeg)", () => {
    expect(() => validateUploadedRecording({ originalFilename: "meeting.wav", declaredMimeType: "audio/mpeg", buffer: wavBuffer() })).toThrow(
      expect.objectContaining({ code: "MEETING_INTELLIGENCE_FILE_UNSUPPORTED" })
    );
  });

  it("rejects a file whose magic bytes do not match its declared type — the browser MIME type alone is never trusted", () => {
    // Declares itself a WAV file (extension + MIME both say wav) but the actual bytes are an MP3 signature.
    expect(() => validateUploadedRecording({ originalFilename: "meeting.wav", declaredMimeType: "audio/wav", buffer: mp3Buffer() })).toThrow(
      expect.objectContaining({ code: "MEETING_INTELLIGENCE_FILE_UNSUPPORTED" })
    );
  });

  it("rejects a renamed non-media file with a spoofed extension and MIME type but no matching magic bytes", () => {
    const fakeBuffer = Buffer.from("this is not audio data at all, just plain text pretending to be one");
    expect(() => validateUploadedRecording({ originalFilename: "malware.mp3", declaredMimeType: "audio/mpeg", buffer: fakeBuffer })).toThrow(
      expect.objectContaining({ code: "MEETING_INTELLIGENCE_FILE_UNSUPPORTED" })
    );
  });
});
