import NewOrderForm from "./new-order-form";

/**
 * Server-Page für die Auftragsanlage. Auth/Betriebs-Check erfolgt bereits in
 * der Portal-Shell ([app/portal/layout.tsx]); hier wird nur das Client-Formular
 * gerendert.
 */
export default function NewOrderPage() {
  return <NewOrderForm />;
}
