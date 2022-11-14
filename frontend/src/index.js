import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import { BrowserRouter, Routes, Route } from "react-router-dom";
import SquarePaymenForm from './modules/SquarePaymentForm';
import SquarePaymenFormSandbox from './modules/SquarePaymentFormSandbox';

export default function Router() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/warframehub/purchase/vip/sandbox" element={<SquarePaymenFormSandbox />}>
          <Route index element={<SquarePaymenFormSandbox />} />
        </Route>
        <Route path="/warframehub/purchase/vip" element={<SquarePaymenForm />}>
          <Route index element={<SquarePaymenForm />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <Router />
);