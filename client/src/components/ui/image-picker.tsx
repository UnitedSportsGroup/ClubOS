// Drop-in image input. Two paths in one component: paste a URL OR upload a
// file. On upload, hits /api/admin/uploads/image which re-encodes the file
// to webp + makes it public. Returns a /objects/... URL we store on the
// block.

import { useRef, useState } from "react";
import { Upload, Link as LinkIcon, X, Loader2, Image as ImageIcon } from "lucide-react";
import { Input } from "@/components/ui/input";

interface Props {
  value?: string;
  onChange: (url: string) => void;
  label?: string;
  className?: string;
}

export function ImagePicker({ value, onChange, label, className }: Props) {
  const [mode, setMode] = useState<"url" | "upload">(value && !value.startsWith("/objects/") ? "url" : "upload");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const upload = async (file: File) => {
    setUploading(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/admin/uploads/image", { method: "POST", body: fd, credentials: "include" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Upload failed");
      onChange(data.url);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className={`space-y-2 ${className ?? ""}`}>
      {label && <label className="text-[10px] uppercase tracking-wider text-white/40">{label}</label>}

      <div className="flex gap-1 mb-1">
        <button
          type="button"
          onClick={() => setMode("upload")}
          className={`px-2.5 py-1 rounded-md text-[10px] uppercase tracking-wider transition ${mode === "upload" ? "bg-blue-600 text-white" : "bg-white/[0.04] text-white/50"}`}
        >
          <Upload className="w-3 h-3 inline mr-1" /> Upload
        </button>
        <button
          type="button"
          onClick={() => setMode("url")}
          className={`px-2.5 py-1 rounded-md text-[10px] uppercase tracking-wider transition ${mode === "url" ? "bg-blue-600 text-white" : "bg-white/[0.04] text-white/50"}`}
        >
          <LinkIcon className="w-3 h-3 inline mr-1" /> URL
        </button>
      </div>

      {value && (
        <div className="relative w-full max-w-xs rounded-lg overflow-hidden border border-white/10 bg-black/20">
          <img src={value} alt="Preview" className="w-full h-32 object-cover" />
          <button
            type="button"
            onClick={() => onChange("")}
            className="absolute top-1.5 right-1.5 w-6 h-6 rounded-md bg-black/60 hover:bg-black text-white/80 flex items-center justify-center"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      )}

      {mode === "url" ? (
        <Input
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder="https://… (Unsplash, your own URL, etc.)"
          className="bg-white/[0.03] border-white/10 text-white text-sm"
        />
      ) : (
        <>
          <input
            ref={inputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/avif"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
          />
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
            className="w-full px-4 py-3 rounded-lg border-2 border-dashed border-white/15 hover:border-blue-500/40 bg-white/[0.02] hover:bg-blue-500/[0.05] text-sm text-white/60 hover:text-white/80 transition flex items-center justify-center gap-2"
          >
            {uploading
              ? <><Loader2 className="w-4 h-4 animate-spin" /> Uploading…</>
              : value
                ? <><ImageIcon className="w-4 h-4" /> Replace image</>
                : <><Upload className="w-4 h-4" /> Click to upload</>}
          </button>
          <p className="text-[10px] text-white/30">JPG, PNG, WEBP up to 10MB. Auto-resized to 1920px max.</p>
        </>
      )}

      {error && <div className="text-[11px] text-red-400">{error}</div>}
    </div>
  );
}
