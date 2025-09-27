const express = require('express');
const midtransClient = require('midtrans-client');
const admin = require('firebase-admin');
require('dotenv').config();

admin.initializeApp();
const db = admin.firestore();

const app = express();
app.use(express.json());
const path = require('path');

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '/index.html'));
});

let snap = new midtransClient.Snap({
    isProduction: process.env.MIDTRANS_IS_PRODUCTION === 'true',
    serverKey: process.env.MIDTRANS_SERVER_KEY
});

// ENDPOINT BARU UNTUK MULTI-VENDOR CHECKOUT
app.post('/create-multivendor-transaction', async (req, res) => {
    try {
        const { allItems, customerDetails, userId, address } = req.body;

        if (!allItems || !customerDetails || !userId || !address || allItems.length === 0) {
            return res.status(400).json({ error: 'Missing required fields in request body' });
        }

        // 1. Kelompokkan item berdasarkan sellerId
        const ordersBySeller = allItems.reduce((acc, item) => {
            const { sellerId } = item;
            if (!acc[sellerId]) {
                acc[sellerId] = [];
            }
            acc[sellerId].push(item);
            return acc;
        }, {});

        // 2. Buat ID unik untuk pembayaran utama (parent) dan hitung total keseluruhan
        const parentOrderId = `WARNUPARENT-${Date.now()}`;
        const grandTotal = allItems.reduce((sum, item) => sum + (item.price * item.quantity), 0);
        
        // 3. Kurangi stok untuk semua produk dalam satu transaksi database
        await db.runTransaction(async (t) => {
            for (const item of allItems) {
                const productRef = db.collection('products').doc(item.id);
                const productDoc = await t.get(productRef);
                if (!productDoc.exists) throw new Error(`Product with ID ${item.id} not found!`);
                
                const currentStock = productDoc.data().stock;
                const newStock = currentStock - item.quantity;
                if (newStock < 0) throw new Error(`Not enough stock for product ${item.name}.`);
                
                t.update(productRef, { stock: newStock });
            }
        });

        // 4. Buat dokumen pesanan terpisah untuk setiap toko
        const batch = db.batch();
        for (const sellerId in ordersBySeller) {
            const sellerItems = ordersBySeller[sellerId];
            const sellerTotal = sellerItems.reduce((sum, item) => sum + (item.price * item.quantity), 0);
            const childOrderId = `WARNU-${sellerId.substring(0, 4)}-${Date.now()}`;

            const orderData = {
                orderId: childOrderId,
                parentOrderId: parentOrderId, // Tautkan ke pembayaran utama
                userId: userId,
                totalAmount: sellerTotal,
                items: sellerItems,
                customerName: customerDetails.first_name,
                paymentStatus: 'pending',
                orderStatus: 'diproses',
                address: address,
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
                sellerId: sellerId
            };
            const orderRef = db.collection('orders').doc(childOrderId);
            batch.set(orderRef, orderData);
        }
        await batch.commit();

        // 5. Buat satu transaksi Midtrans untuk total keseluruhan
        const parameter = {
            "transaction_details": { "order_id": parentOrderId, "gross_amount": grandTotal },
            "item_details": allItems,
            "customer_details": customerDetails,
            "callbacks": { "finish": "https://warnu.app/finish" }
        };

        const transaction = await snap.createTransaction(parameter);
        res.json({ token: transaction.token });

    } catch (e) {
        console.error('Error creating multi-vendor transaction:', e.message);
        if (e.message.includes("Not enough stock")) {
            return res.status(400).json({ error: e.message });
        }
        res.status(500).json({ error: "Failed to create transaction." });
    }
});


// SESUAIKAN NOTIFICATION HANDLER UNTUK MULTI-VENDOR
app.post('/notification-handler', (req, res) => {
    snap.transaction.notification(req.body)
        .then(async (statusResponse) => {
            const orderId = statusResponse.order_id;
            const transactionStatus = statusResponse.transaction_status;
            const fraudStatus = statusResponse.fraud_status;

            console.log(`Notification for Order ID ${orderId}: ${transactionStatus}`);
            
            let newStatus = 'pending';
            if (transactionStatus == 'settlement' || (transactionStatus == 'capture' && fraudStatus == 'accept')) {
                newStatus = 'settlement';
            } else if (transactionStatus == 'cancel' || transactionStatus == 'deny' || transactionStatus == 'expire') {
                newStatus = 'failed';
                // TODO: Logika untuk mengembalikan stok jika pembayaran gagal
            }

            // Cek apakah ini notifikasi untuk parent order atau single order
            if (orderId.startsWith('WARNUPARENT-')) {
                const ordersQuery = db.collection('orders').where('parentOrderId', '==', orderId);
                const querySnapshot = await ordersQuery.get();

                if (!querySnapshot.empty) {
                    const batch = db.batch();
                    querySnapshot.forEach(doc => {
                        const orderRef = db.collection('orders').doc(doc.id);
                        batch.update(orderRef, { paymentStatus: newStatus });
                    });
                    await batch.commit();
                }
            } else {
                // Fallback untuk single order jika masih digunakan
                const orderRef = db.collection('orders').doc(orderId);
                await orderRef.update({ paymentStatus: newStatus });
            }
            
            res.status(200).send('OK');
        })
        .catch((e) => {
            console.error('Error processing notification:', e.message);
            res.status(500).send('Error');
        });
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});