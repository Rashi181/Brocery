"""CHECK 1 (hour 0-2): does the parser read WhatsApp exports correctly? No AI involved.

    python checks/check_1_whatsapp.py                        # both sample chats
    python checks/check_1_whatsapp.py ~/Downloads/chat.txt   # a REAL export from your phone
"""
import sys

from common import FIX, done, ok, section

from intelligence.whatsapp import ChatParseError, participants, parse_whatsapp, recent_window, render_for_llm


def check_sample(path):
    section(f"Sample: {path.name}")
    msgs = parse_whatsapp(path.read_text(encoding="utf-8"))
    recent = recent_window(msgs)
    people = participants(recent)
    ok(people == ["Jordan", "Priya", "Sam", "Maya"], f"participants {people}")
    ok(not any("Apt 4B" in p for p in participants(msgs)), "group name / system lines not treated as people")
    ok(all(m.idx >= 3 for m in recent), "old messages (charger, 2 weeks ago) dropped by window")
    media = [m for m in recent if m.is_media]
    ok(len(media) == 1 and media[0].sender == "Maya", "Maya's photo flagged as media")
    tacos = next(m for m in recent if "tacos" in m.text)
    ok("cilantro" in tacos.text and tacos.text.count("\n") == 3, "multi-line taco message kept together")
    ok(all(m.timestamp for m in recent), "every message has a timestamp")
    ok(recent[-1].timestamp.month == 9 and recent[-1].timestamp.day == 24, "date read as Sep 24 (MDY)")
    return render_for_llm(recent)


def check_real(path):
    section(f"Your export: {path}")
    try:
        msgs = parse_whatsapp(open(path, encoding="utf-8").read())
    except ChatParseError as e:
        ok(False, "parsed", f"{e} Open the file: does each line start with a date?")
        return
    people = participants(msgs)
    ok(len(msgs) > 0, f"{len(msgs)} messages")
    ok(len(people) >= 2, f"participants: {people}", "Only one person? Check the export includes others.")
    stamped = sum(1 for m in msgs if m.timestamp)
    ok(stamped == len(msgs), f"{stamped}/{len(msgs)} timestamps parsed",
       "Some dates failed. Try CHAT_DATE_ORDER=DMY or MDY in .env", soft=True)
    print("\n  Last 8 lines as the AI will see them:")
    print("  " + render_for_llm(recent_window(msgs))[-1200:].replace("\n", "\n  "))


if __name__ == "__main__":
    transcript = check_sample(FIX / "sample_chat_android.txt")
    ios = check_sample(FIX / "sample_chat_ios.txt")
    section("Android and iOS give the same transcript")
    ok(transcript == ios, "identical transcripts")
    for p in sys.argv[1:]:
        check_real(p)
    done()
