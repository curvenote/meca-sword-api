export function zipResponse(data: Uint8Array, name: string) {
  return new Response(data as Uint8Array<ArrayBuffer>, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${name.replace(/["\\\r\n]/g, '')}"`,
    },
  });
}
