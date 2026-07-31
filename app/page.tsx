import type { Metadata } from "next";
import { GreenProofApp } from "../components/GreenProofApp";

export const metadata: Metadata = {
  title: "GreenProof · Shared rooftop evidence",
  description:
    "A data-driven digital twin showing how shared rooftop solar serves two tenants, with traceable public-data evidence.",
};

export default function Home() {
  return <GreenProofApp />;
}
