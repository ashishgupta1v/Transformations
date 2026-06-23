require('dotenv').config();
const prisma = require('../src/utils/db');
const { enqueueVideoRun } = require('../src/queue/producer');
const phaseGate = require('../src/utils/phaseGate');

async function regenerate() {
  const runId = 'run-1782109263270';
  const jobId = `${runId}:resume:2-regenerate-${Date.now()}`;

  // We need to set the status back to running
  await prisma.videoRun.update({
    where: { id: runId },
    data: { status: 'running', error: null, finishedAt: null }
  });

  // Re-enqueue Phase 2
  const jobData = {
    runId: runId,
    jobId: jobId,
    theme: "adiyogi-orb-reveal",
    skipPublish: false,
    overrides: {
      "baseImageUrl":"https://bmzeakkslcsd.compat.objectstorage.ap-mumbai-1.oraclecloud.com/transformations-bucket/user-inputs/1782109254340_upload_1782109253870_Gemini_Generated_Image_fww20zfww20zfww2.png?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Content-Sha256=UNSIGNED-PAYLOAD&X-Amz-Credential=356022f041af23dc55505692f524d991c80dee15%2F20260622%2Fap-mumbai-1%2Fs3%2Faws4_request&X-Amz-Date=20260622T062055Z&X-Amz-Expires=86400&X-Amz-Signature=ad0de0da70e56b6a86641f401c4d3c80b9820c846799099cd07cad4efc068e7f&X-Amz-SignedHeaders=host&x-amz-checksum-mode=ENABLED&x-id=GetObject"
    },
    resumeFromPhase: 2,
    resumeState: {
      phase1Result: {
        "url":"https://cdn.muapi.ai/outputs/generated/32e2a50d9c5a4cfa8829ee60c781bf3d.mp4",
        "taskId":"2a4f2e10-0d6f-4450-a47f-88a9cdecae8b",
        "provider":"muapiKling",
        "tier":"B",
        "costUsd":0.45
      },
      usage: { muapiKling: 1 },
      skipPublish: false,
      overrides: {
        "baseImageUrl":"https://bmzeakkslcsd.compat.objectstorage.ap-mumbai-1.oraclecloud.com/transformations-bucket/user-inputs/1782109254340_upload_1782109253870_Gemini_Generated_Image_fww20zfww20zfww2.png?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Content-Sha256=UNSIGNED-PAYLOAD&X-Amz-Credential=356022f041af23dc55505692f524d991c80dee15%2F20260622%2Fap-mumbai-1%2Fs3%2Faws4_request&X-Amz-Date=20260622T062055Z&X-Amz-Expires=86400&X-Amz-Signature=ad0de0da70e56b6a86641f401c4d3c80b9820c846799099cd07cad4efc068e7f&X-Amz-SignedHeaders=host&x-amz-checksum-mode=ENABLED&x-id=GetObject"
      }
    }
  };

  await enqueueVideoRun(jobData);
  console.log(`Successfully enqueued regeneration job: ${jobId}`);
  
  // Clean up any pending phase gates to prevent conflicts
  try {
    await phaseGate.reject(runId, 'Regenerating');
  } catch (e) {}

  process.exit(0);
}

regenerate();
