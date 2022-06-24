// Copyright (C) 2022  Marcus Huber (Xenorio)

// This program is free software: you can redistribute it and/or modify it under the terms of the GNU Affero General Public License as published
// by the Free Software Foundation, either version 3 of the License, or (at your option) any later version.

// This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU Affero General Public License for more details.

// You should have received a copy of the GNU Affero General Public License along with this program.  If not, see <https://www.gnu.org/licenses/>.

const express = require('express')
const fetch = require('cross-fetch')
const ms = require('ms')
const { createMollieClient } = require('@mollie/api-client');
const cors = require('cors')

var app = express()

app.use(express.json())
app.use(express.urlencoded({ extended: true }))
app.use(cors())

app.use((req, res, next) => {
    res.set('x-powered-by', "MixoVerse Backend")
    next()
})

const config = require('./config.js')

const mollieClient = createMollieClient({ apiKey: config.keys.mollie });

let products = require('./products.json')
const proxy = require('./proxy.json')

let proxyCache = {}

function adjustPrice(product, owned) {

    let price = product.price

    for (let x in products) {
        x = products[x]
        if (x.id > owned) break
        if (x.id == owned) price = price - x.price
    }

    return price

}

app.post(config.prefix + '/webhook', async(req, res, next) => {
    let id = req.body.id

    let payment = await mollieClient.payments.get(id);

    if (payment.status == 'paid') {
        let r = await fetch(config.webhook, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                embeds: [{
                    title: "Bestellung Bezahlt",
                    description: payment.description,
                    url: "https://discordapp.com",
                    color: 65280,
                    fields: [{
                            name: 'Preis',
                            value: `${payment.amount.value} ${payment.amount.currency}`
                        },
                        {
                            name: 'Methode',
                            value: payment.method
                        }
                    ],
                    footer: {
                        text: id
                    }
                }]
            })
        })
    }

    res.send('Success')
})

app.get(config.prefix + '/products', (req, res, next) => {
    res.json(products)
})

app.get(config.prefix + '/userinfo', (req, res, next) => {
    let name = req.query['username']
    if (!name) return res.json({
        error: 'Ungültiger Benutzername'
    })

    if (name == 'PeterZwegat') {
        res.json({
            owned: 0
        })
    } else {
        res.json({
            owned: -1
        })
    }

})

app.get(config.prefix + '/prepareorder', async(req, res, next) => {
    let name = req.query['username']
    if (!name) return res.json({
        error: 'Ungültiger Benutzername'
    })

    let productId = req.query['product']
    let product
    for (let x in products) {
        if (products[x].id == productId) product = products[x]
    }
    if (!product) return res.json({
        error: 'Ungültiges Produkt'
    })

    let price = adjustPrice(product, -1).toFixed(2)

    if (name == 'PeterZwegat') price = adjustPrice(product, 0).toFixed(2)

    let payment = await mollieClient.payments.create({
        amount: {
            value: price,
            currency: 'EUR'
        },
        description: `MixoVerse | ${product.name} | ${name}`,
        redirectUrl: config.url + '/shopsuccess',
        webhookUrl: config.url + config.config.prefix + '/webhook'
    });

    res.json({
        url: payment.getCheckoutUrl()
    })

})

app.get(config.prefix + '/preparedonation', async(req, res, next) => {
    let name = req.query['username']
    if (!name) return res.json({
        error: 'Ungültiger Benutzername'
    })

    let amount = parseFloat(req.query['amount'])

    if (isNaN(amount)) {
        res.json({
            error: 'Ungültige Summe'
        })
        return
    }

    if (amount > 100 || amount < 1) {
        res.json({
            error: 'Es sind nur Spendensummen von 1-100€ möglich'
        })
        return
    }

    let price = amount.toFixed(2)

    let payment = await mollieClient.payments.create({
        amount: {
            value: price,
            currency: 'EUR'
        },
        description: `MixoVerse | Spende | ${name}`,
        redirectUrl: config.url + '/donationsuccess',
        webhookUrl: config.url + config.config.prefix + '/webhook'
    });

    res.json({
        url: payment.getCheckoutUrl()
    })

})

let discordcache = {
    img: {}
}
setInterval(() => {
    discordcache = {
        img: {}
    }
}, ms('1h'))
app.get(config.prefix + '/discordimage', async(req, res, next) => {

    let url

    if (!discordcache[req.query['id']]) {
        let data = await fetch(`https://discord.com/api/v10/users/${req.query['id']}`, {
            method: 'GET',
            headers: {
                'Authorization': 'Bot ' + config.keys.discord
            }
        })

        data = await data.json()

        if (!data || !data.avatar) {
            return res.json({
                error: 'Ein Problem ist aufgetreten'
            })
        }

        url = `https://cdn.discordapp.com/avatars/${data.id}/${data.avatar}?size=1024`
        discordcache[req.query['id']] = url
    } else {
        url = discordcache[req.query['id']]
    }

    if (discordcache.img[url]) {
        res.set('content-type', discordcache.img[url].type)
        res.send(discordcache.img[url].buffer)
    } else {
        let response = await fetch(url)
        let buffer = await response.buffer()

        discordcache.img[url] = {
            buffer: buffer,
            type: response.headers.get('content-type')
        }

        res.set('content-type', response.headers.get('content-type'))
        res.send(buffer)
    }

})

app.get(config.prefix + '/proxy/*', async(req, res, next) => {
    let name = req.originalUrl.split('/proxy/')[1]

    if (proxyCache[name]) {
        res.set('content-type', proxyCache[name].type)
        res.send(proxyCache[name].buffer)
        return
    }

    if (!proxy[name]) {
        console.log(`[proxy] ${name} not found`)
        res.status(404).send("")
        return
    }

    let url = proxy[name].url

    let response = await fetch(url)
    let buffer = await response.buffer()

    proxyCache[name] = {
        type: response.headers.get('content-type'),
        buffer: buffer
    }

    res.set('content-type', response.headers.get('content-type'))

    res.send(buffer)
})

app.listen(3030, () => {
    console.log(`Listening`)
})