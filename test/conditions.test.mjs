/**
 * Where a question created from its parent lands.
 *
 * A dependent question added at the bottom of a form of twenty-three is
 * technically correct and useless: the firm cannot see what it hangs off, and
 * the client meets it long after the answer that decides it.
 */
import { placeUnderParent, orderForCondition } from "../src/lib/question-order.ts";

let failures = 0;
let checks = 0;

function check(label, actual, expected) {
  checks++;
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    failures++;
    console.error(
      `  FAIL  ${label}\n        expected ${JSON.stringify(expected)}\n        actual   ${JSON.stringify(actual)}`,
    );
  } else {
    console.log(`  ok    ${label}`);
  }
}

const q = (id, parent = null) => ({ id, depends_on_question_id: parent });
const ids = (list) => (list === null ? null : list.map((x) => x.id));

console.log("\nconditions · where a dependent question lands\n");

// Added at the end, as every new question is, and belonging under "b".
check(
  "it moves up to sit under the question it hangs off",
  ids(placeUnderParent([q("a"), q("b"), q("c"), q("d"), q("new", "b")], "new", "b")),
  ["a", "b", "new", "c", "d"],
);

// A second question on the same answer goes below the first, not ahead of it —
// the order they were written in is the order they were meant to be asked in.
check(
  "a second one lands below the first",
  ids(placeUnderParent([q("a"), q("b"), q("one", "b"), q("c"), q("two", "b")], "two", "b")),
  ["a", "b", "one", "two", "c"],
);

// Nothing to do, so the caller can skip the write.
check(
  "already in place moves nothing",
  placeUnderParent([q("a"), q("b"), q("child", "b"), q("c")], "child", "b"),
  null,
);

check(
  "a parent that is not there is left alone",
  placeUnderParent([q("a"), q("child", "gone")], "child", "gone"),
  null,
);

console.log("\nconditions · the arrangement that actually breaks\n");

// orderForCondition covers the other case: a parent sitting after its child is
// asked too late, so the condition never matches and the question never shows.
check(
  "a parent below its child is pulled above it",
  ids(orderForCondition([q("child"), q("a"), q("parent")], "child", "parent")),
  ["a", "parent", "child"],
);
check(
  "a parent already above is left where it is",
  orderForCondition([q("parent"), q("a"), q("child")], "child", "parent"),
  null,
);

console.log(`\n${checks - failures}/${checks} checks passed\n`);
process.exit(failures === 0 ? 0 : 1);
