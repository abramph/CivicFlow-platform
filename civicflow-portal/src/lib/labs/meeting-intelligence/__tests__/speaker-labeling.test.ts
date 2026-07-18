import { describe, expect, it } from "vitest";
import {
  VOICE_IDENTIFICATION_STATUS,
  applyManualSpeakerMapping,
  proposeSpeakerMappingFromAttendeeList,
} from "../speaker-labeling";

describe("proposeSpeakerMappingFromAttendeeList", () => {
  it("maps speaker labels to attendees positionally with low, non-actionable confidence", () => {
    const result = proposeSpeakerMappingFromAttendeeList(
      ["Speaker A", "Speaker B"],
      [{ id: "att-1", name: "Alex Chair" }, { id: "att-2", name: "Bailey Secretary" }]
    );
    expect(result[0]).toMatchObject({ speakerLabel: "Speaker A", suggestedAttendeeId: "att-1", method: "attendee_list_order" });
    expect(result[0].confidence).toBeLessThan(0.5);
    expect(result[1]).toMatchObject({ speakerLabel: "Speaker B", suggestedAttendeeId: "att-2" });
  });

  it("leaves a speaker unassigned (confidence 0) when there are more speakers than attendees", () => {
    const result = proposeSpeakerMappingFromAttendeeList(["Speaker A", "Speaker B"], [{ id: "att-1", name: "Alex Chair" }]);
    expect(result[1]).toMatchObject({ suggestedAttendeeId: null, confidence: 0, method: "unassigned" });
  });

  it("never returns confidence 1 from the heuristic alone — only manual confirmation can", () => {
    const result = proposeSpeakerMappingFromAttendeeList(["Speaker A"], [{ id: "att-1", name: "Alex Chair" }]);
    expect(result[0].confidence).toBeLessThan(1);
  });
});

describe("applyManualSpeakerMapping", () => {
  it("overrides a candidate with confidence 1 and method 'manual' when the secretary confirms it", () => {
    const candidates = proposeSpeakerMappingFromAttendeeList(["Speaker A"], [{ id: "att-1", name: "Alex Chair" }]);
    const corrected = applyManualSpeakerMapping(candidates, {
      "Speaker A": { id: "att-2", name: "Bailey Secretary" },
    });
    expect(corrected[0]).toMatchObject({ suggestedAttendeeId: "att-2", suggestedAttendeeName: "Bailey Secretary", confidence: 1, method: "manual" });
  });

  it("leaves candidates without an override untouched", () => {
    const candidates = proposeSpeakerMappingFromAttendeeList(["Speaker A", "Speaker B"], [
      { id: "att-1", name: "Alex Chair" },
      { id: "att-2", name: "Bailey Secretary" },
    ]);
    const corrected = applyManualSpeakerMapping(candidates, { "Speaker A": { id: "att-9", name: "Someone Else" } });
    expect(corrected[1]).toEqual(candidates[1]);
  });
});

describe("voice identification (documented, not built)", () => {
  it("is explicitly marked not_implemented — no biometric identification exists in this spike", () => {
    expect(VOICE_IDENTIFICATION_STATUS).toBe("not_implemented");
  });
});
