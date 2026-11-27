---
'@retn0/beluga': patch
---

When a new message would cross the model's context threshold, compact the earlier conversation first. The new message stays visible and you can stop the response during compaction. If the model returns an empty or truncated summary, keep the previous history.
