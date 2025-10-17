const { db, admin } = require('../config/firebase');
const snap = require('../config/midtrans');

const createTransaction = async (allItems, customerDetails) => {
    const { userId, name, email, phone, address } = customerDetails;
    const parentOrderId = `WARNUPARENT-${Date.now()}`;
    const grandTotal = allItems.reduce((sum, item) => sum + (item.price * item.quantity), 0);

    // 1. Validasi stok dan update dalam satu transaksi database
    await db.runTransaction(async (t) => {
        const productRefs = allItems.map(item => db.collection('products').doc(item.id));
        const productDocs = await t.getAll(...productRefs);

        productDocs.forEach((productDoc, i) => {
            const item = allItems[i];
            if (!productDoc.exists) {
                throw new Error(`Produk dengan ID ${item.id} tidak ditemukan!`);
            }
            const currentStock = productDoc.data().stock;
            const newStock = currentStock - item.quantity;
            if (newStock < 0) {
                throw new Error(`Stok untuk produk ${item.name} tidak mencukupi.`);
            }
            t.update(productRefs[i], { stock: newStock });
        });
    });

    // 2. Kelompokkan item berdasarkan seller dan buat order
    const ordersBySeller = allItems.reduce((acc, item) => {
        const { sellerId } = item;
        if (!acc[sellerId]) acc[sellerId] = [];
        acc[sellerId].push(item);
        return acc;
    }, {});

    const batch = db.batch();
    for (const sellerId in ordersBySeller) {
        const sellerItems = ordersBySeller[sellerId];
        const sellerTotal = sellerItems.reduce((sum, item) => sum + (item.price * item.quantity), 0);
        const childOrderId = `WARNU-${sellerId.substring(0, 4)}-${Date.now()}`;

        const orderData = {
            orderId: childOrderId,
            parentOrderId,
            userId,
            totalAmount: sellerTotal,
            items: sellerItems,
            customerName: name,
            customerPhone: phone,
            paymentStatus: 'pending',
            orderStatus: 'pending',
            address,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            sellerId,
            storeName: sellerItems[0].storeName
        };
        const orderRef = db.collection('orders').doc(childOrderId);
        batch.set(orderRef, orderData);
    }
    await batch.commit();

    // 3. Buat transaksi Midtrans
    const parameter = {
        transaction_details: { order_id: parentOrderId, gross_amount: grandTotal },
        item_details: allItems,
        customer_details: {
            first_name: name,
            email,
            phone,
            billing_address: { address },
            shipping_address: { first_name: name, phone, address }
        },
        callbacks: { finish: "https://warnu.app/finish" }
    };

    const transaction = await snap.createTransaction(parameter);
    return transaction.token;
};

const handleNotification = async (notificationPayload) => {
    const statusResponse = await snap.transaction.notification(notificationPayload);
    const { order_id, transaction_status, fraud_status } = statusResponse;

    let newStatus = 'pending';
    let newOrderStatus = 'pending';

    if (transaction_status == 'settlement' || (transaction_status == 'capture' && fraud_status == 'accept')) {
        newStatus = 'settlement';
        newOrderStatus = 'pending';
    } else if (transaction_status == 'cancel' || transaction_status == 'deny' || transaction_status == 'expire') {
        newStatus = 'failed';
        newOrderStatus = 'cancelled';
        // TODO: Tambahkan logic untuk mengembalikan stok
    }

    const ordersQuery = db.collection('orders').where(
        order_id.startsWith('WARNUPARENT-') ? 'parentOrderId' : 'orderId', '==', order_id
    );
    const querySnapshot = await ordersQuery.get();

    if (!querySnapshot.empty) {
        const batch = db.batch();
        querySnapshot.forEach(doc => {
            const orderRef = db.collection('orders').doc(doc.id);
            batch.update(orderRef, { paymentStatus: newStatus, orderStatus: newOrderStatus });
        });
        await batch.commit();
    }
};


module.exports = {
    createTransaction,
    handleNotification
};