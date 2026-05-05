import { useState, useRef, useCallback, useEffect } from "react";
import { useRoute, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Upload, FileCheck, X, ArrowRight, AlertCircle } from "lucide-react";

interface OrderFile {
  id: number;
  filename: string;
  fileSize: number | null;
  mimeType: string | null;
  uploadedBy: string;
  fileType: string;
  uploadedAt: string;
}

interface OrderStatus {
  orderNumber: string;
  status: string;
  customerName: string;
  customerEmail: string;
  totalCents: number;
  pickupReadyDate: string | null;
  materialName: string;
}

function formatBytes(bytes: number | null): string {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function PrintUpload() {
  const [, params] = useRoute("/print/order/:token/upload");
  const [, setLocation] = useLocation();
  const token = params?.token;

  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const { data: order, isLoading: orderLoading } = useQuery<OrderStatus>({
    queryKey: ["/api/print/orders/by-token", token, refreshKey],
    queryFn: () => fetch(`/api/print/orders/by-token/${token}`).then(r => {
      if (!r.ok) throw new Error("Order not found");
      return r.json();
    }),
    enabled: !!token,
  });

  const { data: files = [], refetch: refetchFiles } = useQuery<OrderFile[]>({
    queryKey: ["/api/print/orders/files", token, refreshKey],
    queryFn: () => fetch(`/api/print/orders/${token}/files`).then(r => r.json()),
    enabled: !!token,
  });

  const uploadFiles = useCallback(async (selected: FileList | File[]) => {
    if (!token) return;
    const list = Array.from(selected);
    if (list.length === 0) return;

    setUploading(true);
    setError(null);
    setProgress(`Uploading ${list.length} file${list.length > 1 ? "s" : ""}...`);

    try {
      const fd = new FormData();
      for (const f of list) fd.append("files", f);

      const res = await fetch(`/api/print/orders/${token}/upload`, { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Upload failed");

      setProgress("Uploaded.");
      setRefreshKey(k => k + 1);
      await refetchFiles();
      setTimeout(() => setProgress(null), 1500);
    } catch (e: any) {
      setError(e.message);
      setProgress(null);
    } finally {
      setUploading(false);
    }
  }, [token, refetchFiles]);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    uploadFiles(e.dataTransfer.files);
  }, [uploadFiles]);

  if (orderLoading) {
    return <div className="min-h-screen bg-white flex items-center justify-center text-zinc-500">Loading...</div>;
  }
  if (!order) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-2xl font-bold mb-2">Order not found</h2>
          <p className="text-zinc-500 mb-4">This link may have expired.</p>
          <button onClick={() => setLocation("/print")} className="text-blue-600 underline">Start a new order</button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white text-zinc-900">
      <header className="border-b border-zinc-200 bg-white">
        <div className="max-w-3xl mx-auto px-6 py-4 flex items-center justify-between">
          <button onClick={() => setLocation(`/print/order/${token}`)} className="text-sm font-medium text-zinc-500 hover:text-zinc-900">
            ← Back to order
          </button>
          <a href="tel:0800800199" className="text-sm font-medium hover:text-zinc-600">0800 800 199</a>
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-6 py-12">
        <div className="text-[10px] uppercase tracking-wider font-semibold text-zinc-500 mb-2">Order {order.orderNumber}</div>
        <h1 className="text-3xl sm:text-4xl font-black tracking-tight mb-2">Upload your artwork</h1>
        <p className="text-zinc-500 mb-8">
          {order.materialName} · ready by {order.pickupReadyDate ?? "—"}
        </p>

        {/* Drop zone */}
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          onClick={() => inputRef.current?.click()}
          className={`rounded-2xl border-2 border-dashed p-12 text-center cursor-pointer transition ${
            dragOver ? "border-zinc-900 bg-zinc-50" : "border-zinc-300 hover:border-zinc-500"
          }`}
        >
          <Upload className={`w-10 h-10 mx-auto mb-3 ${dragOver ? "text-zinc-900" : "text-zinc-400"}`} />
          <div className="font-semibold text-zinc-900 mb-1">
            {uploading ? "Uploading..." : "Drop files here, or click to browse"}
          </div>
          <div className="text-sm text-zinc-500">
            PDF · AI · EPS · PNG · JPG · TIFF · ZIP — up to 100 MB each
          </div>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept=".pdf,.ai,.eps,.png,.jpg,.jpeg,.tif,.tiff,.webp,.svg,.zip,.psd"
            className="hidden"
            onChange={(e) => e.target.files && uploadFiles(e.target.files)}
          />
        </div>

        {progress && !error && (
          <div className="mt-4 text-sm text-zinc-600 text-center">{progress}</div>
        )}
        {error && (
          <div className="mt-4 p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-800 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            {error}
          </div>
        )}

        {/* Tips */}
        <div className="mt-6 p-4 rounded-lg bg-zinc-50 border border-zinc-200">
          <div className="text-sm font-semibold mb-2">Tips for great print</div>
          <ul className="text-sm text-zinc-600 space-y-1.5">
            <li>• Convert text to outlines (or include the fonts in a zip)</li>
            <li>• Use CMYK colour mode where possible</li>
            <li>• 150 DPI is fine for big banners — they're viewed from a distance</li>
            <li>• Add 3 mm bleed if your design goes to the edge</li>
            <li>• Not sure? Just upload what you have — we'll let you know if something's off</li>
          </ul>
        </div>

        {/* Already uploaded */}
        {files.length > 0 && (
          <div className="mt-10">
            <h2 className="text-lg font-bold mb-3">Uploaded ({files.length})</h2>
            <div className="space-y-2">
              {files.map((f) => (
                <div key={f.id} className="flex items-center gap-3 p-3 rounded-lg border border-zinc-200 bg-white">
                  <FileCheck className="w-4 h-4 text-green-600 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{f.filename}</div>
                    <div className="text-xs text-zinc-500">
                      {formatBytes(f.fileSize)} · uploaded by {f.uploadedBy}
                    </div>
                  </div>
                  <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded bg-zinc-100 text-zinc-600">
                    {f.fileType}
                  </span>
                </div>
              ))}
            </div>

            <button
              onClick={() => setLocation(`/print/order/${token}`)}
              className="w-full mt-6 py-3.5 rounded-xl bg-zinc-900 text-white font-semibold hover:bg-zinc-800 transition flex items-center justify-center gap-2"
            >
              I'm done <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
