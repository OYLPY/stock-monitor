export default function Home() {
  return (
    <main>
      <h1>独立 Worker 关闭页面验证</h1>
      <p>提交后会显示任务受理结果。提交完成后关闭此标签页。</p>
      <form action="/api/tasks" method="post">
        <label htmlFor="idempotencyKey">任务幂等键</label>
        <input
          id="idempotencyKey"
          name="idempotencyKey"
          defaultValue="browser-close-proof"
          pattern="[A-Za-z0-9_-]{1,64}"
          readOnly
          required
        />
        <button type="submit">启动持久任务</button>
      </form>
    </main>
  );
}
