import { ApolloServer } from "@apollo/server";
import { NextRequest, NextResponse } from "next/server";
import { typeDefs } from "@/graphql/schema";
import { resolvers, type GqlContext } from "@/graphql/resolvers";
import { auth } from "@/auth";
import { isRecord } from "@/lib/guards";

export const runtime = "nodejs";

interface GraphQLRequestBody {
  query?: string;
  variables?: Record<string, unknown>;
  operationName?: string;
}

const globalForApollo = globalThis as unknown as {
  apolloServer?: ApolloServer<GqlContext>;
  apolloStartPromise?: Promise<void>;
};

function getApolloServer(): ApolloServer<GqlContext> {
  if (!globalForApollo.apolloServer) {
    const apolloServer = new ApolloServer<GqlContext>({ typeDefs, resolvers });
    globalForApollo.apolloServer = apolloServer;
    globalForApollo.apolloStartPromise = apolloServer.start();
  }
  return globalForApollo.apolloServer;
}

const server = getApolloServer();

async function ensureStarted() {
  await globalForApollo.apolloStartPromise;
}

const MISSING_QUERY = "Request must include a GraphQL query string";
const INVALID_VARIABLES = "Variables must be a JSON object";

function jsonError(error: string, status: number): NextResponse {
  return NextResponse.json({ error }, { status });
}

function parseJson(text: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

function toGraphQLRequest(
  query: unknown,
  variables: unknown,
  operationName: unknown,
): GraphQLRequestBody | NextResponse {
  if (typeof query !== "string" || !query) return jsonError(MISSING_QUERY, 400);
  if (variables != null && !isRecord(variables)) return jsonError(INVALID_VARIABLES, 400);
  return {
    query,
    variables: variables ?? undefined,
    operationName: typeof operationName === "string" ? operationName : undefined,
  };
}

function parseRequestBody(body: string): GraphQLRequestBody | NextResponse {
  const parsed = parseJson(body);
  if (!parsed.ok) return jsonError("Invalid JSON", 400);
  if (!isRecord(parsed.value)) return jsonError(MISSING_QUERY, 400);
  const { query, variables, operationName } = parsed.value;
  return toGraphQLRequest(query, variables, operationName);
}

function parseQueryParams(searchParams: URLSearchParams): GraphQLRequestBody | NextResponse {
  const variablesParam = searchParams.get("variables");
  const variables = variablesParam ? parseJson(variablesParam) : { ok: true as const, value: undefined };
  if (!variables.ok) return jsonError("Invalid variables JSON", 400);
  return toGraphQLRequest(searchParams.get("query"), variables.value, searchParams.get("operationName"));
}

async function readGraphQLRequest(req: NextRequest): Promise<GraphQLRequestBody | NextResponse> {
  if (req.method === "POST") {
    const body = await req.text();
    return body ? parseRequestBody(body) : jsonError(MISSING_QUERY, 400);
  }
  return parseQueryParams(req.nextUrl.searchParams);
}

async function handleRequest(req: NextRequest): Promise<NextResponse> {
  await ensureStarted();

  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return jsonError("Unauthorized", 401);

  const graphqlRequest = await readGraphQLRequest(req);
  if (graphqlRequest instanceof NextResponse) return graphqlRequest;

  const response = await server.executeOperation(graphqlRequest, {
    contextValue: { userId },
  });

  if (response.body.kind !== "single") {
    return jsonError("Unexpected response kind", 500);
  }

  return NextResponse.json(response.body.singleResult, {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

export const GET = handleRequest;
export const POST = handleRequest;
