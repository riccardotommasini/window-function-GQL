CREATE CONSTRAINT account_name IF NOT EXISTS
FOR (account:Account)
REQUIRE account.name IS UNIQUE;

CREATE CONSTRAINT currency_code IF NOT EXISTS
FOR (currency:Currency)
REQUIRE currency.code IS UNIQUE;

CREATE CONSTRAINT frame_row_name IF NOT EXISTS
FOR (frameRow:FrameRow)
REQUIRE frameRow.name IS UNIQUE;

CREATE CONSTRAINT temporal_frame_row_name IF NOT EXISTS
FOR (temporalFrameRow:TemporalFrameRow)
REQUIRE temporalFrameRow.name IS UNIQUE;

MATCH (n)
WHERE size(labels(n)) = 0
DETACH DELETE n;

MERGE (alice:Account {name: 'Alice'})
SET alice.domain = 'Research', alice.score = 88;

MERGE (bob:Account {name: 'Bob'})
SET bob.domain = 'Research', bob.score = 72;

MERGE (carol:Account {name: 'Carol'})
SET carol.domain = 'Engineering', carol.score = 91;

MERGE (dana:Account {name: 'Dana'})
SET dana.domain = 'Engineering', dana.score = 84;

MERGE (eve:Account {name: 'Eve'})
SET eve.domain = 'Sales', eve.score = 60;

MERGE (frank:Account {name: 'Frank'})
SET frank.domain = 'Sales', frank.score = 95;

MERGE (eur:Currency {code: 'EUR'})
SET eur.risk = 1;

MERGE (usd:Currency {code: 'USD'})
SET usd.risk = 2;

MERGE (gbp:Currency {code: 'GBP'})
SET gbp.risk = 3;

MATCH (alice:Account {name: 'Alice'}), (bob:Account {name: 'Bob'})
MERGE (alice)-[alice_to_bob:TRANSFER {currency: 'EUR'}]->(bob)
SET alice_to_bob.amount = 2500;

MATCH (bob:Account {name: 'Bob'}), (carol:Account {name: 'Carol'})
MERGE (bob)-[bob_to_carol:TRANSFER {currency: 'EUR'}]->(carol)
SET bob_to_carol.amount = 1200;

MATCH (carol:Account {name: 'Carol'}), (dana:Account {name: 'Dana'})
MERGE (carol)-[carol_to_dana:TRANSFER {currency: 'EUR'}]->(dana)
SET carol_to_dana.amount = 800;

MATCH (alice:Account {name: 'Alice'}), (eve:Account {name: 'Eve'})
MERGE (alice)-[alice_to_eve:TRANSFER {currency: 'USD'}]->(eve)
SET alice_to_eve.amount = 3000;

MATCH (eve:Account {name: 'Eve'}), (dana:Account {name: 'Dana'})
MERGE (eve)-[eve_to_dana:TRANSFER {currency: 'USD'}]->(dana)
SET eve_to_dana.amount = 1500;

MATCH (eur:Currency {code: 'EUR'}), (bob:Account {name: 'Bob'})
MERGE (eur)-[:ISSUED_FOR]->(bob);

MATCH (eur:Currency {code: 'EUR'}), (carol:Account {name: 'Carol'})
MERGE (eur)-[:ISSUED_FOR]->(carol);

MATCH (usd:Currency {code: 'USD'}), (carol:Account {name: 'Carol'})
MERGE (usd)-[:ISSUED_FOR]->(carol);

MATCH (eur:Currency {code: 'EUR'}), (dana:Account {name: 'Dana'})
MERGE (eur)-[:ISSUED_FOR]->(dana);

MATCH (gbp:Currency {code: 'GBP'}), (dana:Account {name: 'Dana'})
MERGE (gbp)-[:ISSUED_FOR]->(dana);

MATCH (usd:Currency {code: 'USD'}), (dana:Account {name: 'Dana'})
MERGE (usd)-[:ISSUED_FOR]->(dana);

MATCH (usd:Currency {code: 'USD'}), (eve:Account {name: 'Eve'})
MERGE (usd)-[:ISSUED_FOR]->(eve);

MATCH (alice:Account {name: 'Alice'}), (carol:Account {name: 'Carol'})
MERGE (alice)-[:KNOWS]->(carol);

MATCH (bob:Account {name: 'Bob'}), (dana:Account {name: 'Dana'})
MERGE (bob)-[:KNOWS]->(dana);

MATCH (alice:Account {name: 'Alice'}), (bob:Account {name: 'Bob'})
MERGE (alice)-[:KNOWS]->(bob);

MATCH (dana:Account {name: 'Dana'}), (frank:Account {name: 'Frank'})
MERGE (dana)-[:KNOWS]->(frank);

MATCH (carol:Account {name: 'Carol'}), (alice:Account {name: 'Alice'})
MERGE (carol)-[:KNOWS]->(alice);

MATCH (eve:Account {name: 'Eve'}), (carol:Account {name: 'Carol'})
MERGE (eve)-[:KNOWS]->(carol);

MERGE (frame1:FrameRow {name: 'r1'})
SET frame1.ord = 10, frame1.amount = 1;

MERGE (frame2:FrameRow {name: 'r2'})
SET frame2.ord = 10, frame2.amount = 2;

MERGE (frame3:FrameRow {name: 'r3'})
SET frame3.ord = 20, frame3.amount = 3;

MERGE (frame4:FrameRow {name: 'r4'})
SET frame4.ord = 30, frame4.amount = 4;

MERGE (frame5:FrameRow {name: 'r5'})
SET frame5.ord = 35, frame5.amount = 5;

MERGE (temporal1:TemporalFrameRow {name: 'd1'})
SET temporal1.day = date('2026-01-01'), temporal1.amount = 1;

MERGE (temporal2:TemporalFrameRow {name: 'd2'})
SET temporal2.day = date('2026-01-03'), temporal2.amount = 2;

MERGE (temporal3:TemporalFrameRow {name: 'd3'})
SET temporal3.day = date('2026-01-07'), temporal3.amount = 3;

MERGE (temporal4:TemporalFrameRow {name: 'd4'})
SET temporal4.day = date('2026-01-10'), temporal4.amount = 4;
