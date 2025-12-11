import { NextRequest, NextResponse } from 'next/server';
import { getAgent } from '@/lib/mcp-agent';
import { ICPAttribute, buildClusterExpression } from '@/lib/csv-processor';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { selectedAttributes } = body;

    if (!selectedAttributes || selectedAttributes.length === 0) {
      return NextResponse.json({ estimate: null });
    }

    const agent = getAgent();

    // Step 1: Extract unique cluster names from selected attributes
    // ICPAttribute already has clusterName properly normalized
    const clusterNames = [...new Set(
      selectedAttributes.map((attr: ICPAttribute) => attr.clusterName)
    )];

    console.log('[estimate-audience] Selected attributes:', selectedAttributes.map((a: ICPAttribute) => ({
      attributeName: a.attributeName,
      clusterName: a.clusterName,
      attributeValue: a.attributeValue
    })));

    console.log('[estimate-audience] Cluster names to look up:', clusterNames);

    // Step 2: Get cluster IDs using list_clusters
    const listClustersResult = await agent.callToolDirect('list_clusters', {
      cluster_names: clusterNames,
    });

    console.log('[estimate-audience] Raw list_clusters result:', JSON.stringify(listClustersResult, null, 2));

    // Parse the clusters response - handle MCP errors (matching chat route logic)
    let clusters: any[] = [];
    if (listClustersResult?.content) {
      let content = listClustersResult.content;
      console.log('[estimate-audience] Content type:', typeof content, Array.isArray(content) ? 'array' : '');

      // Handle string content
      if (typeof content === 'string') {
        // Check for MCP error
        if (content.startsWith('MCP error')) {
          console.error('[estimate-audience] MCP Error:', content);
          return NextResponse.json({ estimate: null });
        }
        try {
          content = JSON.parse(content);
        } catch {
          console.error('[estimate-audience] Failed to parse string content:', content.substring(0, 200));
          return NextResponse.json({ estimate: null });
        }
      }

      // Handle array content with text type
      if (Array.isArray(content) && content[0]?.type === 'text') {
        const textContent = content[0].text;
        console.log('[estimate-audience] Text content preview:', textContent.substring(0, 200));
        // Check for MCP error in text content
        if (textContent.startsWith('MCP error')) {
          console.error('[estimate-audience] MCP Error in text:', textContent);
          return NextResponse.json({ estimate: null });
        }
        try {
          content = JSON.parse(textContent);
        } catch {
          console.error('[estimate-audience] Failed to parse text content:', textContent.substring(0, 200));
          return NextResponse.json({ estimate: null });
        }
      }

      clusters = content?.clusters || [];
      console.log('[estimate-audience] Parsed clusters count:', clusters.length);
    } else {
      console.log('[estimate-audience] No content in listClustersResult');
    }

    if (clusters.length === 0) {
      return NextResponse.json({ estimate: null });
    }

    // Step 3: Build cluster ID map
    const clusterMap = new Map<string, string>();
    for (const cluster of clusters) {
      const key = `${cluster.name}=${cluster.value}`;
      clusterMap.set(key, String(cluster.cluster_id));
    }

    // Step 4: Build expression from selected attributes
    const expression = buildClusterExpression(selectedAttributes, clusterMap);

    if (!expression) {
      return NextResponse.json({ estimate: null });
    }

    // Step 5: Call find_persons with limit 0 to just get the count
    const findResult = await agent.callToolDirect('find_persons', {
      expression,
      identifier_type: 'email',
      limit: 1, // Only need the total count, not actual results
      format: 'none',
    });

    // Parse the find_persons response
    let total = 0;
    if (findResult?.content) {
      let content = findResult.content;
      if (Array.isArray(content) && content[0]?.type === 'text') {
        try {
          const parsed = JSON.parse(content[0].text);
          total = parseInt(parsed.total) || 0;
        } catch {
          console.error('Failed to parse find_persons response');
        }
      }
    }

    return NextResponse.json({ estimate: total });
  } catch (error) {
    console.error('Error estimating audience:', error);
    return NextResponse.json({ estimate: null }, { status: 500 });
  }
}
