import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import { BrowserRouter, Routes, Route } from "react-router-dom";
import SquarePaymenForm from './modules/SquarePaymentForm';

export default function Router() {
  return (
    <BrowserRouter>
      <Routes>
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