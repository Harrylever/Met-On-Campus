import "server-only"

// Optional: recent deployments from Railway's GraphQL API. Needs a project token; skipped when not configured.
export type Deployment = {
  id: string
  status: string
  createdAt: string
  commit: string | null
  message: string | null
}
export async function recentDeployments(): Promise<{
  configured: boolean
  error?: string
  deployments: Deployment[]
}> {
  const {
    RAILWAY_API_TOKEN: token,
    RAILWAY_PROJECT_ID: projectId,
    RAILWAY_ENVIRONMENT_ID: environmentId,
    RAILWAY_SERVICE_ID: serviceId,
  } = process.env
  if (!token || !projectId || !environmentId || !serviceId)
    return { configured: false, deployments: [] }
  try {
    const res = await fetch("https://backboard.railway.com/graphql/v2", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "project-access-token": token,
      },
      body: JSON.stringify({
        query: `query($input: DeploymentListInput!) { deployments(first: 8, input: $input) { edges { node { id status createdAt meta } } } }`,
        variables: { input: { projectId, environmentId, serviceId } },
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    })
    const json = await res.json()
    if (json.errors?.length)
      return {
        configured: true,
        error: String(json.errors[0].message).slice(0, 200),
        deployments: [],
      }
    const deployments: Deployment[] = (json.data?.deployments?.edges ?? []).map(
      (e: any) => ({
        id: e.node.id,
        status: e.node.status,
        createdAt: e.node.createdAt,
        commit: e.node.meta?.commitHash?.slice(0, 7) ?? null,
        message:
          e.node.meta?.commitMessage?.split("\n")[0]?.slice(0, 90) ?? null,
      }),
    )
    return { configured: true, deployments }
  } catch (e) {
    return {
      configured: true,
      error: e instanceof Error ? e.message : "request failed",
      deployments: [],
    }
  }
}
