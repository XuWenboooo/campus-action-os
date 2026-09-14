# AI pipeline

The implemented local pipeline standardizes text, separates lines, extracts audience/actions/deadlines/materials/location/platform, binds each explicit field to source evidence, constructs a sequential Action Graph, runs `Error Shield`, validates the response, and emits `succeeded` or `needs_confirmation`. Unknown or ambiguous time values remain `null` with `precision=unknown`. No live provider or credentials are used.
