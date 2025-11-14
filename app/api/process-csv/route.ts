import { NextRequest, NextResponse } from 'next/server';
import { getAgent } from '@/lib/mcp-agent';
import { flattenProfileData, extractDemographics, extractInterests, EnrichedRow } from '@/lib/csv-processor';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { rows, detectedFields, enrichmentType = 'full' } = body;

    if (!rows || !Array.isArray(rows)) {
      return NextResponse.json(
        { error: 'Rows array is required' },
        { status: 400 }
      );
    }

    const agent = getAgent();
    const enrichedRows: EnrichedRow[] = [];

    // Process each row
    for (const row of rows) {
      try {
        const enrichedRow: EnrichedRow = { ...row };

        // Resolve identity first
        let personId: string | undefined;

        if (detectedFields.emails && row[detectedFields.emails]) {
          const result = await resolveIdentity(agent, 'email', row[detectedFields.emails]);
          if (result) {
            personId = result.person_id;
            enrichedRow.person_id = personId;
            enrichedRow.overall_quality_score = result.quality_score;
          }
        } else if (detectedFields.phones && row[detectedFields.phones]) {
          const result = await resolveIdentity(agent, 'phone', row[detectedFields.phones]);
          if (result) {
            personId = result.person_id;
            enrichedRow.person_id = personId;
            enrichedRow.overall_quality_score = result.quality_score;
          }
        } else if (detectedFields.addresses && row[detectedFields.addresses]) {
          const result = await resolveIdentity(agent, 'address', row[detectedFields.addresses]);
          if (result) {
            personId = result.person_id;
            enrichedRow.person_id = personId;
            enrichedRow.overall_quality_score = result.quality_score;
          }
        } else if (detectedFields.personIds && row[detectedFields.personIds]) {
          personId = row[detectedFields.personIds];
          enrichedRow.person_id = personId;
        }

        // Get full profile if person_id is available
        if (personId && enrichmentType === 'full') {
          const profile = await getPersonProfile(agent, personId);

          if (profile) {
            // Extract demographics
            const demographics = extractDemographics(profile);
            Object.assign(enrichedRow, demographics);

            // Extract interests
            const interests = extractInterests(profile);
            Object.assign(enrichedRow, interests);

            // Flatten and add all profile data
            const flattened = flattenProfileData(profile);
            Object.assign(enrichedRow, flattened);
          }
        }

        enrichedRows.push(enrichedRow);

      } catch (error) {
        console.error(`Error processing row:`, error);
        // Add row with error marker
        enrichedRows.push({
          ...row,
          enrichment_error: 'Failed to enrich',
        });
      }
    }

    return NextResponse.json({
      enrichedData: enrichedRows,
      processedCount: enrichedRows.length,
    });

  } catch (error) {
    console.error('Error in process-csv API:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

async function resolveIdentity(agent: any, idType: string, identifier: string) {
  try {
    const messages = [
      {
        role: 'user' as const,
        content: `Resolve this ${idType}: ${identifier}. Return only the person_id and quality_score.`,
      }
    ];

    const result = await agent.chat(messages);

    // Parse the response to extract person_id
    // This is a simplified version - in production you'd want more robust parsing
    if (result.toolCalls && result.toolCalls.length > 0) {
      const resolveCall = result.toolCalls.find((tc: any) => tc.name === 'resolve_identities');
      if (resolveCall && resolveCall.result) {
        const content = resolveCall.result.content;
        if (Array.isArray(content) && content.length > 0) {
          const textContent = content.find((c: any) => c.type === 'text');
          if (textContent) {
            const data = JSON.parse(textContent.text);
            if (data.resolved_identities && data.resolved_identities.length > 0) {
              return {
                person_id: data.resolved_identities[0].person_id,
                quality_score: data.resolved_identities[0].overall_quality_score,
              };
            }
          }
        }
      }
    }

    return null;
  } catch (error) {
    console.error('Error resolving identity:', error);
    return null;
  }
}

async function getPersonProfile(agent: any, personId: string) {
  try {
    const messages = [
      {
        role: 'user' as const,
        content: `Get the full profile for person_id: ${personId}`,
      }
    ];

    const result = await agent.chat(messages);

    // Parse the response to extract profile data
    if (result.toolCalls && result.toolCalls.length > 0) {
      const profileCall = result.toolCalls.find((tc: any) => tc.name === 'get_person');
      if (profileCall && profileCall.result) {
        const content = profileCall.result.content;
        if (Array.isArray(content) && content.length > 0) {
          const textContent = content.find((c: any) => c.type === 'text');
          if (textContent) {
            return JSON.parse(textContent.text);
          }
        }
      }
    }

    return null;
  } catch (error) {
    console.error('Error getting person profile:', error);
    return null;
  }
}
