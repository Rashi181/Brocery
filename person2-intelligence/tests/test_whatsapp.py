import pytest

from intelligence.whatsapp import ChatParseError, participants, parse_whatsapp, recent_window, render_for_llm


def test_android_and_ios_samples_agree():
    from conftest import FIX
    a = recent_window(parse_whatsapp((FIX / "sample_chat_android.txt").read_text()))
    i = recent_window(parse_whatsapp((FIX / "sample_chat_ios.txt").read_text()))
    assert participants(a) == participants(i) == ["Jordan", "Priya", "Sam", "Maya"]
    assert render_for_llm(a) == render_for_llm(i)


def test_dmy_detected_from_day_over_12():
    msgs = parse_whatsapp("24/09/2026, 20:05 - Ana: milk\n03/10/2026, 09:00 - Ben: eggs\n")
    assert msgs[0].timestamp.month == 9 and msgs[1].timestamp.month == 10 and msgs[1].timestamp.day == 3


def test_forced_order(monkeypatch):
    monkeypatch.setenv("CHAT_DATE_ORDER", "DMY")
    m = parse_whatsapp("03/04/26, 10:00 - Ana: milk\n")[0]
    assert (m.timestamp.day, m.timestamp.month) == (3, 4)


def test_multiline_media_system_and_invisible_chars():
    raw = ("9/24/26, 8:00\u202fPM - Ana: list:\neggs\nbread\n"
           "9/24/26, 8:01 PM - Ben: <Media omitted>\n"
           "9/24/26, 8:02 PM - Ben added Cy\n"
           "\u200e[9/24/26, 8:03:00 PM] Cy: \u200eimage omitted\n")
    msgs = parse_whatsapp(raw)
    assert msgs[0].text == "list:\neggs\nbread"
    assert msgs[1].is_media and msgs[2].is_system and msgs[3].is_media
    assert participants(msgs) == ["Ana", "Ben", "Cy"]
    assert "[photo or media" in render_for_llm(msgs)


def test_colon_inside_message_kept():
    m = parse_whatsapp("9/24/26, 8:00 PM - Ana: note: get 2 limes\n")[0]
    assert m.sender == "Ana" and m.text == "note: get 2 limes"


def test_not_whatsapp_raises():
    with pytest.raises(ChatParseError):
        parse_whatsapp("just some text\nnothing here")


def test_window_keeps_recent_only():
    raw = "1/1/26, 10:00 AM - Ana: old\n2/1/26, 10:00 AM - Ana: new\n"
    assert [m.text for m in recent_window(parse_whatsapp(raw), days=7)] == ["new"]
