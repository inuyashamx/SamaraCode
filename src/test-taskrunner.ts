import { TaskRunner } from "./core/task-runner.js";

async function main() {
  console.log("🔄 SamaraCode - Task Runner Test\n");

  const runner = new TaskRunner(3); // Max 3 concurrent

  // Listen for events
  runner.on("task", (event) => {
    const task = runner.getTask(event.taskId);
    console.log(`  📬 Event: ${event.type} [${task?.name}]`);
  });

  // Submit parallel tasks
  console.log("━━━ Submitting 5 tasks (max concurrent: 3) ━━━\n");

  const ids: string[] = [];

  ids.push(runner.submit("fast-task-1", "Quick task", async (progress) => {
    progress("working...");
    await new Promise((r) => setTimeout(r, 500));
    return { result: "fast-1 done" };
  }));

  ids.push(runner.submit("fast-task-2", "Quick task 2", async (progress) => {
    progress("working...");
    await new Promise((r) => setTimeout(r, 300));
    return { result: "fast-2 done" };
  }));

  ids.push(runner.submit("medium-task", "Medium task", async (progress) => {
    progress("step 1...");
    await new Promise((r) => setTimeout(r, 800));
    progress("step 2...");
    await new Promise((r) => setTimeout(r, 400));
    return { result: "medium done" };
  }));

  ids.push(runner.submit("queued-task-1", "Will be queued", async (progress) => {
    progress("running after queue...");
    await new Promise((r) => setTimeout(r, 200));
    return { result: "queued-1 done" };
  }));

  ids.push(runner.submit("queued-task-2", "Will also be queued", async (progress) => {
    progress("running after queue...");
    await new Promise((r) => setTimeout(r, 200));
    return { result: "queued-2 done" };
  }));

  console.log(`Submitted ${ids.length} tasks\n`);

  // Wait a bit and check status
  await new Promise((r) => setTimeout(r, 100));
  console.log(`\n━━━ Status after 100ms ━━━`);
  console.log(`Running: ${runner.getRunning().length}`);
  console.log(`Pending: ${runner.getPending().length}`);
  console.log(`Completed: ${runner.getCompleted().length}`);

  // Wait for all to complete
  await new Promise((r) => setTimeout(r, 3000));

  console.log(`\n━━━ Final status ━━━`);
  console.log(`Running: ${runner.getRunning().length}`);
  console.log(`Pending: ${runner.getPending().length}`);
  console.log(`Completed: ${runner.getCompleted().length}`);

  console.log(`\n━━━ Task details ━━━`);
  for (const task of runner.getAll()) {
    const duration = task.completedAt && task.startedAt
      ? `${(task.completedAt.getTime() - task.startedAt.getTime())}ms`
      : "?";
    console.log(`  ${task.status === "completed" ? "✅" : "❌"} ${task.name}: ${task.status} (${duration})`);
    if (task.result) console.log(`    → ${JSON.stringify(task.result)}`);
  }

  console.log(`\n━━━ Summary for LLM ━━━`);
  console.log(runner.getSummary());

  console.log("\n✨ Task runner test complete!");
}

main().catch(console.error);
