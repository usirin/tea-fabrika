# Written from the text of kamp-us/demlik issue 709 only, before its fix was read.
Feature: move apply keeps the extension each import was written with

  As someone moving files with structure-sweep in a NodeNext repository
  I want every import it rewrites to keep the extension I wrote
  So that the repository still typechecks after the move

  # The fixture: package `app`, NodeNext, three files that move, four importers
  # that name them through an import, an `export … from`, a dynamic `import()`
  # and a type-position `import("…")`. The moved runner names a file that does
  # not move, also in a type position, and a moved file names a folder's index.

  @change
  Scenario Outline: every rewritten specifier keeps its "<ext>"
    Given a NodeNext repository whose relative imports end in "<ext>"
    And a plan that moves three files named by four importers
    When I apply the plan
    Then the repository gained one rename commit and then one rewrite commit
    And every relative specifier in the package ends in "<ext>"
    And every relative specifier in the package names a file that exists
    And tsc --noEmit passes over the package
    When I apply the plan again
    Then the repository gained no commit

    Examples:
      | ext |
      | .ts |
      | .js |

  @change
  Scenario: a moved file's own import of a file that stayed keeps its extension, in a type position too
    Given a NodeNext repository whose relative imports end in ".ts"
    And a plan that moves three files named by four importers
    When I apply the plan
    Then the moved file "app/src/jobs/runner.ts" names "../reviewer.ts" in a type position
    And the moved file "app/src/core/format.ts" names "../x/index.ts"

  @guard
  Scenario: an import written with no extension stays without one
    Given a Bundler repository whose relative imports have no extension
    And a plan that moves three files named by four importers
    When I apply the plan
    Then every relative specifier in the package has no extension
    And every relative specifier in the package names a file that exists
