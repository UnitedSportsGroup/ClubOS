import { AlertCircle } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="min-h-[80vh] w-full flex items-center justify-center">
      <div className="text-center animate-fade-in-up" style={{ animationDelay: '0ms', opacity: 0 }}>
        <div className="w-16 h-16 rounded-2xl bg-blue-500/[0.04] border border-blue-500/[0.1] flex items-center justify-center mx-auto mb-6 animate-pulse-glow">
          <AlertCircle className="h-8 w-8 text-blue-400/25" />
        </div>
        <h1 className="text-2xl font-semibold text-white mb-2">404</h1>
        <p className="text-[13px] text-white/35 mb-6">This page doesn't exist</p>
        <Button asChild className="bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-400 hover:to-blue-500 text-white border-0 rounded-xl glow-btn">
          <Link href="/">Back to Dashboard</Link>
        </Button>
      </div>
    </div>
  );
}
