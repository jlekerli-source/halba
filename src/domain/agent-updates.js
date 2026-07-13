function slug(value) {
  return String(value || "agent-update")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "agent-update";
}

export function agentUpdatePosts(receipts = {}) {
  const updates = Array.isArray(receipts?.updates) ? receipts.updates : [];
  return updates.map((update) => {
    const id = slug(update.id || [update.projectId, update.createdAt, update.title].filter(Boolean).join("-"));
    const createdAt = update.createdAt;
    const agent = update.agent || "agent";
    const sourcePath = update.sourcePath;
    return {
      id: `agent-${id}`,
      projectId: update.projectId,
      title: update.title || "Agent update",
      author: agent,
      createdAt,
      body: update.body || "",
      evidence: [
        {
          kind: "handoff",
          label: update.evidenceLabel || update.title || "Agent update receipt",
          path: sourcePath,
          status: update.status || "IMPORTED"
        }
      ],
      replies: [
        {
          id: `${id}-receipt`,
          author: "halba",
          createdAt,
          body: `agent receipt: ${agent} / ${sourcePath}`
        }
      ]
    };
  });
}

export function mergeAgentUpdates(feed, receipts = {}) {
  const posts = agentUpdatePosts(receipts);
  if (!posts.length) return feed;
  return { ...feed, posts: [...posts, ...(feed?.posts || [])] };
}
