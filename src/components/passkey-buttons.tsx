"use client";

import { signIn } from "next-auth/webauthn";
import { useState } from "react";

export function PasskeySignIn() {
  return (
    <button
      type="button"
      onClick={() => signIn("passkey", { redirectTo: "/" })}
      className="h-12 rounded-pill bg-brand-fill font-medium text-white"
    >
      Entrar con Face ID
    </button>
  );
}

/** Se muestra con sesión iniciada: asocia una passkey del iPhone a la cuenta. */
export function PasskeyRegister() {
  const [state, setState] = useState<"idle" | "done" | "error">("idle");
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await signIn("passkey", { action: "register", redirect: false });
          setState("done");
        } catch {
          setState("error");
        }
      }}
      className="text-sm text-muted underline-offset-4 hover:underline"
    >
      {state === "done" ? "Passkey registrada" : state === "error" ? "No se pudo registrar" : "Registrar Face ID para entrar"}
    </button>
  );
}
