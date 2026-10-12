import { describe, expect, it } from "vitest";
import { matchIntent, type Contact, type ServiceSettings } from "@/lib/emergency";

const contacts: Contact[] = [
  { id: "1", name: "Priya Sharma", phone: "+91 00000 00001", label: "Mom", primary: true },
  { id: "2", name: "Rahul", phone: "+91 00000 00002", label: "Friend", primary: false },
];
const s: ServiceSettings = { region: "IN", ambulance: "", hospitalName: "", hospitalPhone: "" };
const m = (t: string) => matchIntent([t], contacts, s);

describe("matchIntent", () => {
  it("call my mom / mother", () => {
    expect(m("Call my mom").type === "found" && (m("Call my mom") as any).target.name).toBe("Priya Sharma");
    expect((m("call my mother") as any).target.name).toBe("Priya Sharma");
  });
  it("police", () => expect((m("Call the police") as any).target.phone).toBe("112"));
  it("I need the police", () => expect((m("I need the police") as any).target.key).toBe("police"));
  it("medical help → ambulance 108", () => expect((m("I need medical help") as any).target.phone).toBe("108"));
  it("call an ambulance", () => expect((m("call an ambulance") as any).target.key).toBe("ambulance"));
  it("fire", () => expect((m("there is a fire") as any).target.key).toBe("fire"));
  it("by name", () => expect((m("call Rahul") as any).target.name).toBe("Rahul"));
  it("emergency contact → primary", () => expect((m("call my emergency contact") as any).target.name).toBe("Priya Sharma"));
  it("missing dad", () => expect(m("call my dad")).toMatchObject({ type: "missing", label: "Dad" }));
  it("nonsense", () => expect(m("banana").type).toBe("none"));
  it("custom ambulance override", () => expect((matchIntent(["ambulance"], [], { ...s, ambulance: "044 1234" }) as any).target.phone).toBe("044 1234"));
});
