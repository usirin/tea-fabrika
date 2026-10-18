# Written from the text of kamp-us/demlik issue 686 (its rewritten criteria
# and the shape the owner set), before its fix was read.
Feature: the boundary gate reports a test that loads the whole app

  As a team that lays a service out as a hexagon
  I want the gate to report each test whose imports lead to a composition root
  So that tests drive one feature and the count of tests that load the app only goes down

  # The shop fixture, in scope services/shop: features orders, billing and
  # catalog; src/index.ts (the worker entry) imports src/schema.ts, which
  # imports every feature's index.ts; src/test-support/harness.ts imports
  # src/test-support/server.ts, which imports src/schema.ts; 120 tests import
  # the harness; 100 tests import only their own feature's application code;
  # src/index.test.ts imports src/index.ts; two tests import src/schema.ts only
  # as a type; src/lib/boot.ts, production code, imports src/schema.ts.

  Background:
    Given the shop fixture
    And the rules list the features, testFiles "**/*.test.ts" and "**/test-support/**", and compositionRoots "src/index.ts" and "src/schema.ts"

  @change
  Scenario: the gate lists exactly the tests that load the app, each at its first file
    When I run the gate with --json
    Then it lists 123 rows of kind "test-reaches-composition-root"
    And 120 of them go from a case test to "services/shop/src/test-support/harness.ts"
    And one goes from "services/shop/src/test-support/harness.ts" to "services/shop/src/test-support/server.ts"
    And one goes from "services/shop/src/test-support/server.ts" to "services/shop/src/schema.ts"
    And one goes from "services/shop/src/index.test.ts" to "services/shop/src/index.ts"

  @change
  Scenario: adopt at today's count, then the count only goes down
    When I run the gate with --ci
    Then it exits 1
    And it lists 123 entries for rule B20
    When I accept the crossings with the reason "baseline"
    And I run the gate with --ci twice
    Then both runs exit 0 and the ledger did not change
    When I add a 121st test that imports the harness
    And I run the gate with --ci
    Then it exits 1
    And it lists 1 entry for rule B20, for "case-121.test.ts"
    When I remove that test
    And server.ts stops importing src/schema.ts
    And I run the gate with --ci
    Then it exits 0
    And the ledger keeps 1 entry for rule B20, from "services/shop/src/index.test.ts"

  @change
  Scenario: an entry belongs to its route, so one route's change moves only its own entry
    Given a test "src/catalog/application/two-routes.test.ts" that imports the harness and "src/test-support/other.ts", which imports src/schema.ts
    When I run the gate with --json
    Then the test "two-routes.test.ts" has 2 rows, one to "harness.ts" and one to "other.ts"
    When I accept the crossings with the reason "baseline"
    And the test "two-routes.test.ts" imports only the harness
    And I run the gate with --ci
    Then it exits 0
    And the ledger has no entry from "two-routes.test.ts" to "other.ts"
    When the test "two-routes.test.ts" also imports "src/lib/boot.ts"
    And I run the gate with --ci
    Then it exits 1
    And it lists 1 entry for rule B20, for "two-routes.test.ts"

  @change
  Scenario: the plain view prints one line per test and first file
    When I run the gate with no flags
    Then its output has the line 'B20 test-reaches-composition-root services/shop/src/index.test.ts -> services/shop/src/index.ts  ("./index")'

  @change
  Scenario: a root glob matches the repo-relative path too
    Given the rules list compositionRoots "services/*/src/index.ts" only
    When I run the gate with --json
    Then it lists 1 rows of kind "test-reaches-composition-root"

  @guard
  Scenario: the rule is off unless compositionRoots lists a glob
    Given the rules list no compositionRoots
    When I run the gate with --json
    Then it lists 0 rows of kind "test-reaches-composition-root"
    And its output never says "compositionRoots"

  # The last step was added after the first run at the base commit. Without it
  # both rows passed there: the old gate refuses any unknown key, so "exit 2,
  # one line naming compositionRoots" held for the wrong reason.
  @change
  Scenario Outline: a rules file that cannot work is refused (<why>)
    Given the rules list compositionRoots <roots> and testFiles <tests>
    When I run the gate with --ci
    Then it exits 2
    And no ledger was written
    And one error line names "compositionRoots"
    And that line also names "<says>", the reason it cannot work

    Examples:
      | why                    | roots             | tests            | says          |
      | roots, no tests        | ["src/index.ts"]  | []               | testFiles     |
      | a root that is no glob | ["src/{index.ts"] | ["**/*.test.ts"] | src/{index.ts |
