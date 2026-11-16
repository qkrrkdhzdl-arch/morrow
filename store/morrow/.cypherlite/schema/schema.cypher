CREATE VECTOR INDEX `artifact_brief` FOR (n:`Artifact`) ON (n.`vec`) OPTIONS {indexConfig: {`vector.default_search_expansion_factor`: 3.0,`vector.dimensions`: 128,`vector.hnsw.ef_construction`: 100,`vector.hnsw.m`: 16,`vector.quantization.type`: 'BINARY',`vector.similarity_function`: 'COSINE'}};
CREATE FULLTEXT INDEX `artifact_text` FOR (n:`Artifact`) ON EACH [n.`text`, n.`title`] OPTIONS {indexConfig: {`fulltext.analyzer`: 'standard-no-stop-words',`fulltext.eventually_consistent`: false}};
CREATE CONSTRAINT `artifact_id` FOR (n:`Artifact`) REQUIRE (n.`id`) IS UNIQUE;
CREATE CONSTRAINT `obligation_id` FOR (n:`Obligation`) REQUIRE (n.`id`) IS UNIQUE;
