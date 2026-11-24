/** Download only the client-facing brief. Notes and research are agency working material. */
export function downloadBrief(client: string, brief: string, demo: boolean): void {
  const date = new Date().toLocaleDateString(undefined, { dateStyle: 'long' });
  const heading = demo ? client + ' (fictional demo client)' : client;
  const report = new Blob([`${heading}\nDaily brief · ${date}\n\n${brief.trim()}\n`], {
    type: 'text/plain;charset=utf-8',
  });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(report);
  const filename = client.replace(/[^\p{L}\p{N} -]/gu, '').trim().slice(0, 80);
  link.download = `${filename || 'Client'} - daily brief.txt`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}
