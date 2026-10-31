---
tags: [skill-creator]
max_turns: 60
timeout_seconds: 1800
allowed_tools: [Read, Glob, Grep, Skill, Write, Edit, Bash]
---

Some networks only show a bare handle as their name (e.g. CLOUDFLARENET, SWITCH). Change the pipeline so that when RIPEstat's holder has no readable name after the handle, we use the organisation name from PeeringDB instead. Existing networks in the data should get the better names too, not just new ones.
