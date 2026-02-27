import { AlertCircle } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="min-h-[80vh] w-full flex items-center justify-center">
      <div className="text-center">
        <div className="w-16 h-16 rounded-2xl bg-white/[0.04] border border-white/[0.08] flex items-center justify-center mx-auto mb-6">
          <AlertCircle className="h-8 w-8 text-white/30" />
        </div>
        <h1 className="text-2xl font-semibold text-white mb-2">404</h1>
        <p className="text-[13px] text-white/40 mb-6">This page doesn't exist</p>
        <Button asChild className="bg-blue-500 hover:bg-blue-600 text-white border-0 rounded-lg">
          <Link href="/">Back to Dashboard</Link>
        </Button>
      </div>
    </div>
  );
}
