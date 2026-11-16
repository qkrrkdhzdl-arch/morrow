// Schema for Morrow. The app runs this before writing the sample graph; the CLI
// runs it first when building store/morrow, so the checked-in store and the
// browser store have the same shape.

CREATE CONSTRAINT obligation_id IF NOT EXISTS FOR (o:Obligation) REQUIRE o.id IS UNIQUE;
CREATE CONSTRAINT artifact_id IF NOT EXISTS FOR (a:Artifact) REQUIRE a.id IS UNIQUE;

CREATE VECTOR INDEX artifact_brief IF NOT EXISTS FOR (a:Artifact) ON (a.vec)
  OPTIONS {indexConfig: {`vector.dimensions`: 128, `vector.similarity_function`: 'cosine'}};

CREATE FULLTEXT INDEX artifact_text IF NOT EXISTS FOR (a:Artifact) ON EACH [a.text, a.title];
