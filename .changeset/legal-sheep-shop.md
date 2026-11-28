---
'@retn0/beluga': patch
---

When a new message would cross the model's context threshold, compact the earlier conversation first. The new message stays visible and you can stop the response during compaction. Keep earlier context across successive compactions and preserve the previous history if the model returns an empty or truncated summary.
