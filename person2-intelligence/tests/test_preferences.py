import asyncio
from datetime import datetime, timedelta, timezone

from intelligence.preferences import BackboardPreferenceStore, LocalPreferenceStore, to_spec_source
from intelligence.schemas import PreferenceFact as F


def test_local_dedupe_persist_and_rank(tmp_path):
    s = LocalPreferenceStore(tmp_path / "p.json")
    old = datetime.now(timezone.utc) - timedelta(days=3)
    asyncio.run(s.add(F(requester="Priya", fact="likes Oatly", kind="like", item="oat milk", source="chat", created_at=old)))
    asyncio.run(s.add(F(requester="priya", fact="LIKES OATLY", kind="like", source="chat")))
    asyncio.run(s.add(F(requester="Priya", fact="hates cilantro", kind="dislike", source="chat")))
    asyncio.run(s.add(F(requester="Priya", fact="lactose intolerant", kind="allergy", source="chat", created_at=old)))
    asyncio.run(s.add(F(requester="Sam", fact="vegan", kind="dietary", source="chat")))
    again = LocalPreferenceStore(tmp_path / "p.json")
    got = asyncio.run(again.for_person("PRIYA", "oat milk"))
    assert [f.fact for f in got] == ["lactose intolerant", "likes Oatly", "hates cilantro"]


def test_corrupt_file_does_not_crash(tmp_path):
    p = tmp_path / "p.json"
    p.write_text("{broken")
    assert asyncio.run(LocalPreferenceStore(p).all()) == []


def test_to_spec_source_maps_two_ways():
    chat = F(requester="P", fact="x", source="chat")
    corr = F(requester="P", fact="x", source="correction")
    assert to_spec_source(chat) == "chat" and to_spec_source(corr) == "correction"


class FakeBB:
    def __init__(self, memories=None, fail=False):
        self.added, self.memories, self.fail = [], memories or [], fail

    async def add_memory(self, aid, content, metadata=None):
        if self.fail:
            raise RuntimeError("bb down")
        self.added.append((content, metadata))

    async def search_memories(self, aid, query, limit=5):
        if self.fail:
            raise RuntimeError("bb down")
        return {"memories": self.memories}


def bb_store(tmp_path, fake):
    s = BackboardPreferenceStore.__new__(BackboardPreferenceStore)
    s.client, s.assistant_id, s.mirror = fake, "aid", LocalPreferenceStore(tmp_path / "m.json")
    return s


def test_backboard_write_format_and_no_duplicates(tmp_path):
    fake = FakeBB()
    s = bb_store(tmp_path, fake)
    f = F(requester="Priya", fact="lactose intolerant", kind="allergy", source="chat")
    asyncio.run(s.add(f))
    asyncio.run(s.add(f))
    assert len(fake.added) == 1
    content, meta = fake.added[0]
    assert content == "[Priya] (allergy) lactose intolerant" and meta["requester"] == "Priya"


def test_backboard_search_filters_people_and_merges(tmp_path):
    fake = FakeBB(memories=[
        {"content": "[Priya] (dislike) hates Planet Oat — item: oat milk",
         "metadata": {"requester": "Priya", "kind": "dislike", "source": "correction"}},
        {"content": "[Sam] (dietary) vegan", "metadata": {"requester": "Sam"}},
        {"content": "[priya] (weird) something", "metadata": {}},
    ])
    s = bb_store(tmp_path, fake)
    got = asyncio.run(s.for_person("Priya", "oat milk"))
    facts = {f.fact: f.kind for f in got}
    assert facts == {"hates Planet Oat": "dislike", "something": "other"}


def test_backboard_down_uses_mirror(tmp_path):
    s = bb_store(tmp_path, FakeBB(fail=True))
    asyncio.run(s.add(F(requester="Priya", fact="lactose intolerant", kind="allergy", source="chat")))
    assert [f.fact for f in asyncio.run(s.for_person("Priya"))] == ["lactose intolerant"]
