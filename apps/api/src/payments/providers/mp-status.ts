import { PaymentStatusName } from '../../common/types';

// Mapeamento de status do Mercado Pago para o status interno.
// ⚠ Validar na homologação do Mercado Pago com transações reais de teste.

/** API de Orders (Point): status do pedido. */
export function mapMpOrderStatus(status?: string): PaymentStatusName {
  switch (status) {
    case 'processed':
    case 'approved':
      return 'APPROVED';
    case 'failed':
    case 'rejected':
      return 'DECLINED';
    case 'canceled':
    case 'cancelled':
    case 'expired':
    case 'refunded':
      return 'CANCELED';
    default:
      return 'PENDING'; // created, at_terminal, action_required, processing...
  }
}

/** API de Payments (PIX): status do pagamento. */
export function mapMpPaymentStatus(status?: string): PaymentStatusName {
  switch (status) {
    case 'approved':
    case 'authorized':
      return 'APPROVED';
    case 'rejected':
      return 'DECLINED';
    case 'cancelled':
    case 'canceled':
    case 'refunded':
    case 'charged_back':
      return 'CANCELED';
    default:
      return 'PENDING'; // pending, in_process
  }
}
