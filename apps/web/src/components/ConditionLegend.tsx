import { describePaymentCondition, PAYMENT_CONDITION_FORMATS } from "../lib/entry-freight";

/**
 * A legenda do campo de condicao de pagamento (a `PaymentConditionLegend` do desktop): diz em
 * palavras o parcelamento que o texto digitado gera e, aberta, mostra os formatos aceitos. Usada
 * na Nova entrada e na condicao padrao do cadastro do cliente.
 */
export function ConditionLegend({ value }: { value: string }) {
  const preview = describePaymentCondition(value);
  return (
    <div className="condition-legend">
      <p className={`condition-preview is-${preview.status}`}>{preview.message}</p>
      <details>
        <summary>Como escrever</summary>
        <table>
          <tbody>
            {PAYMENT_CONDITION_FORMATS.map((format) => (
              <tr key={format.example}>
                <td>
                  <code>{format.example}</code>
                </td>
                <td>{format.meaning}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
