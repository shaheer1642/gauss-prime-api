

import * as React from 'react';
import { CreditCard, PaymentForm } from 'react-square-web-payments-sdk';
import axios from 'axios';
import '../App.css';

function SquarePaymenFormSandbox() {
  const [paymentStatus, setPaymentStatus] = React.useState(0);
  const [paymentMessage, setPaymentMessage] = React.useState('');
  
  return (
    <div className="App">
      <header className="App-header">
            <div style={{backgroundColor: '#404e69', borderRadius: '20px', padding: '50px'}}>
        {(paymentStatus == 0 || paymentStatus == 500) ? 
          <PaymentForm
            /**
             * Identifies the calling form with a verified application ID generated from
             * the Square Application Dashboard.
             */
            applicationId="sandbox-sq0idb-dlM0HaihzBAJ_6mLIlfGWg"
            /**
             * Invoked when payment form receives the result of a tokenize generation
             * request. The result will be a valid credit card or wallet token, or an error.
             */
            cardTokenizeResponseReceived={(token, buyer) => {
              console.log(token)
              axios.post("/payments/hubvip", {
                token: token.token,
                discord_id: document.cookie.split('; ').find((row) => row.startsWith('discord_id='))?.split('=')[1],
                sandbox: true
              }).then(res => {
                console.log(res.data)
                if (res.data.code == 200) {
                  setPaymentStatus(200)
                  setPaymentMessage('Your payment is successful!\nYou will receive the receipt on Discord')
                } else {
                  setPaymentStatus(500)
                  setPaymentMessage('Some error occured')
                }
              }).catch(err => {
                console.log(err)
                setPaymentStatus(500)
                setPaymentMessage('Some error occured')
              })
            }}
            /**
             * This function enable the Strong Customer Authentication (SCA) flow
             *
             * We strongly recommend use this function to verify the buyer and reduce
             * the chance of fraudulent transactions.
             */
            createVerificationDetails={() => ({
              /* collected from the buyer */
              amount: '100',
              currencyCode: 'USD',
              billingContact: {
                addressLines: ['123 Main Street', 'Apartment 1'],
                familyName: 'Doe',
                givenName: 'John',
                countryCode: 'GB',
                city: 'London',
              },
              intent: 'CHARGE',
            })}
            /**
             * Identifies the location of the merchant that is taking the payment.
             * Obtained from the Square Application Dashboard - Locations tab.
             */
            locationId="L4WPY00F9H4HC"
          >
              <div style={{margin: '20px'}}>
                Purchase Warframe Hub VIP
              </div>
              <div style={{margin: '20px'}}>
                $3.99
              </div>
              <CreditCard />
          </PaymentForm> : <></>
        }
        <div style={{margin: '20px',color: paymentStatus == 200 ? '#32d93a':'red'}}>
          {paymentMessage}
        </div>
            </div>
      </header>
    </div>
  );
}

export default SquarePaymenFormSandbox;