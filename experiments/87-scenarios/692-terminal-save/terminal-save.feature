# Written from the text of kamp-us/demlik issue 692 and its recorded ruling
# (a failed terminal save rejects done()), before its fix was read.
Feature: done() and result() report the end of a run only once it is saved

  As a host that awaits done() and then exits
  I want done() and result() to say "over" only after the final state is saved
  So that a process that stops right after done() never loses the end of the run

  # The machine: a run that a Sub ends about 10 ms after boot, with a store
  # whose save takes 50 ms and remembers the last state it saved.

  @change
  Scenario Outline: result() is undefined while the final save is in flight (<engine>, run <run>)
    Given a run on the <engine> engine whose store takes 50 ms to save
    When the state turns terminal
    Then the store does not yet hold the terminal state
    And result() is undefined
    When the final save lands
    Then result() is the terminal state

    Examples:
      | engine  | run |
      | Promise | 1   |
      | Promise | 2   |
      | Promise | 3   |
      | Effect  | 1   |
      | Effect  | 2   |
      | Effect  | 3   |

  @change
  Scenario Outline: done() asked <moment> resolves only once the save has landed (<engine>)
    Given a run on the <engine> engine whose store takes 50 ms to save
    When I ask done() <moment>
    Then done() resolves with the terminal state
    And the store held the terminal state when done() resolved

    Examples:
      | engine  | moment                          |
      | Promise | during the final save           |
      | Promise | after getState() turns terminal |
      | Effect  | during the final save           |
      | Effect  | after getState() turns terminal |

  # Split out after the first run at the base commit: these two rows sat in the
  # outline above, tagged @change, and passed there. The issue's own repro says
  # this case already worked, so they are guards. The red run caught the label.
  @guard
  Scenario Outline: done() asked <moment> also waits for the save (<engine>)
    Given a run on the <engine> engine whose store takes 50 ms to save
    When I ask done() <moment>
    Then done() resolves with the terminal state
    And the store held the terminal state when done() resolved

    Examples:
      | engine  | moment         |
      | Promise | before the end |
      | Effect  | before the end |

  @change
  Scenario Outline: a failed final save never reports the run as over (<engine>)
    Given a run on the <engine> engine whose store fails to save the terminal state
    When I ask done() before the end
    And the final save fails
    Then done() rejects with the save failure
    And result() is undefined
    And done() asked again rejects with the save failure

    Examples:
      | engine  |
      | Promise |
      | Effect  |

  @guard
  Scenario Outline: a run with no store answers as soon as the state is set (<engine>)
    Given a run on the <engine> engine with no store
    When the state turns terminal
    Then result() is the terminal state
    And done() asked now resolves with the terminal state

    Examples:
      | engine  |
      | Promise |
      | Effect  |

  @guard
  Scenario Outline: a run restored already over resolves done() at boot (<engine>)
    Given a run on the <engine> engine whose store already holds the terminal state
    When I ask done() at boot
    Then done() resolves with the terminal state

    Examples:
      | engine  |
      | Promise |
      | Effect  |
