import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import PaymentConfirmationScreen from '../payment-confirmation';

describe('PaymentConfirmationScreen', () => {
  it('surfaces recovery copy when the blocked badge is pressed', () => {
    const { getByText, getByTestId } = render(<PaymentConfirmationScreen />);

    expect(getByText('Network Mismatch')).toBeTruthy();

    const badge = getByTestId('action-blocked-badge');
    fireEvent.press(badge);

    expect(
      getByText('wallet is on MAINNET but this action requires TESTNET')
    ).toBeTruthy();
  });

  it('closes the modal and resets state', () => {
    const { getByText, getByTestId, queryByText } = render(<PaymentConfirmationScreen />);

    fireEvent.press(getByTestId('action-blocked-badge'));
    expect(getByText('Network Mismatch')).toBeTruthy();

    fireEvent.press(getByTestId('wallet-switch-help-close'));

    expect(queryByText('Network Mismatch')).toBeNull();
  });
});
