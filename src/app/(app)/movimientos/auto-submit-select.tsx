"use client";

/** Select de filtro que envía su formulario (GET) al cambiar; sin JS sigue funcionando con el botón del form. */
export function AutoSubmitSelect(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} onChange={(e) => e.currentTarget.form?.requestSubmit()} />;
}
