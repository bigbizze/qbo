/**
 * @file Node.js client for QuickBooks V3 API
 * @name node-quickbooks
 * @author Michael Cohen <michael_cohen@intuit.com>
 * @license ISC
 * @copyright 2014 Michael Cohen
 */

const request   = require('request'),
    uuid      = require('uuid').v4,
    debug     = require('request-debug'),
    util      = require('util'),
    formatISO = require('date-fns/fp/formatISO'),
    _         = require('underscore'),
    Promise   = require('bluebird'),
    version   = require('./package.json').version,
    jxon      = require('jxon');

module.exports = QuickBooks

QuickBooks.APP_CENTER_BASE = 'https://appcenter.intuit.com';
QuickBooks.V3_ENDPOINT_BASE_URL = 'https://sandbox-quickbooks.api.intuit.com/v3/company/';
QuickBooks.QUERY_OPERATORS = ['=', 'IN', '<', '>', '<=', '>=', 'LIKE'];
QuickBooks.TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
QuickBooks.REVOKE_URL = 'https://developer.api.intuit.com/v2/oauth2/tokens/revoke';

const sessionId = (() => {
    let result = '';
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const charactersLength = characters.length;
    let counter = 0;
    while (counter < 12) {
        result += characters.charAt(Math.floor(Math.random() * charactersLength));
        counter += 1;
    }
    return result;
})();

const discoverOAuthUrls = function (callback, discoveryUrl) {
    const NEW_ENDPOINT_CONFIGURATION = {};
    request({
        url: discoveryUrl,
        headers: {
            Accept: 'application/json'
        }
    }, function (err, res) {
        if (err) {
            console.log(err);
            return err;
        }

        var json;
        try {
            json = JSON.parse(res.body);
        } catch (error) {
            console.log(error);
            return error;
        }
        NEW_ENDPOINT_CONFIGURATION.AUTHORIZATION_URL = json.authorization_endpoint;
        NEW_ENDPOINT_CONFIGURATION.TOKEN_URL = json.token_endpoint;
        NEW_ENDPOINT_CONFIGURATION.USER_INFO_URL = json.userinfo_endpoint;
        NEW_ENDPOINT_CONFIGURATION.REVOKE_URL = json.revocation_endpoint;
        callback(NEW_ENDPOINT_CONFIGURATION);
    });
};

/**
 * Node.js client encapsulating access to the QuickBooks V3 Rest API. An instance
 * of this class should be instantiated on behalf of each user accessing the api.
 *
 * @param consumerKey - application key
 * @param consumerSecret  - application password
 * @param token - the OAuth generated user-specific key
 * @param tokenSecret - the OAuth generated user-specific password
 * @param realmId - QuickBooks companyId, returned as a request parameter when the user is redirected to the provided callback URL following authentication
 * @param useSandbox - boolean - See https://developer.intuit.com/v2/blog/2014/10/24/intuit-developer-now-offers-quickbooks-sandboxes
 * @param debug - boolean flag to turn on logging of HTTP requests, including headers and body
 * @param minorversion - integer to set minorversion in request
 * @param refreshToken - string to set refresh token
 * @constructor
 */
function QuickBooks(consumerKey, consumerSecret, token, tokenSecret, realmId, useSandbox, debug, minorversion, refreshToken, calledFromNewKey) {
    if (calledFromNewKey !== sessionId) {
        throw new Error("Please initialize this with QuickBooks.new() rather than new QuickBooks()!");
    }
    var prefix = _.isObject(consumerKey) ? 'consumerKey.' : '';
    this.consumerKey = eval(prefix + 'consumerKey');
    this.consumerSecret = eval(prefix + 'consumerSecret');
    this.token = eval(prefix + 'token');
    this.tokenSecret = eval(prefix + 'tokenSecret');
    this.realmId = eval(prefix + 'realmId');
    this.useSandbox = eval(prefix + 'useSandbox');
    this.debug = eval(prefix + 'debug');
    this.endpoint = this.useSandbox
        ? QuickBooks.V3_ENDPOINT_BASE_URL
        : QuickBooks.V3_ENDPOINT_BASE_URL.replace('sandbox-', '');

    this.minorversion = eval(prefix + 'minorversion') || 65;
    this.refreshToken = eval(prefix + 'refreshToken') || null;
}

QuickBooks.new = async function (opts) {
    const clientId = opts.clientId;
    const clientSecret = opts.clientSecret;
    const accessToken = opts.accessToken;
    const realmId = opts.realmId;
    const useSandbox = opts.useSandbox;
    const debug = opts.debug;
    const minorversion = opts?.minorversion ?? null;
    const refreshToken = opts.refreshToken;

    const discoveryUrl = useSandbox ? 'https://developer.intuit.com/.well-known/openid_sandbox_configuration/' : 'https://developer.api.intuit.com/.well-known/openid_configuration/';
    const qboInstance = new QuickBooks(clientId, clientSecret, accessToken, false, realmId, useSandbox, debug, minorversion, refreshToken, sessionId);
    await new Promise((resolve, reject) => {
        discoverOAuthUrls(newConfiguration => {
            try {
                for (const [ key, value ] of Object.entries(newConfiguration)) {
                    QuickBooks[key] = value;
                }
                resolve(null);
            } catch (e) {
                reject(e);
            }
        }, discoveryUrl);
    })
    return qboInstance;
}

/**
 *
 * Use the refresh token to obtain a new access token.
 *
 *
 */

QuickBooks.prototype.refreshAccessToken = function() {
    var auth = (Buffer.from(this.consumerKey + ':' + this.consumerSecret).toString('base64'));

    var postBody = {
        url: QuickBooks.TOKEN_URL,
        headers: {
            Accept: 'application/json',
            'Content-Type': 'application/x-www-form-urlencoded',
            Authorization: 'Basic ' + auth,
        },
        form: {
            grant_type: 'refresh_token',
            refresh_token: this.refreshToken
        }
    };

    return new Promise((resolve, reject) => {
        request.post(postBody, (function (e, r, data) {
            if (r && r.body && r.error!=="invalid_grant") {
                var refreshResponse = JSON.parse(r.body);
                this.refreshToken = refreshResponse.refresh_token;
                this.token = refreshResponse.access_token;
                resolve(data);
            } else {
                reject(e);
            }
        }).bind(this));
    });
};

/**
 * Use either refresh token or access token to revoke access (OAuth2).
 *
 * @param useRefresh - boolean - Indicates which token to use: true to use the refresh token, false to use the access token.
 * @returns {Promise<{error: Error, response, data }>} - Promise that resolves to an object containing the error, response, and data from the request.
 */
QuickBooks.prototype.revokeAccess = function(useRefresh) {
    var auth = (Buffer.from(this.consumerKey + ':' + this.consumerSecret).toString('base64'));
    var revokeToken = useRefresh ? this.refreshToken : this.token;
    var postBody = {
        url: QuickBooks.REVOKE_URL,
        headers: {
            Accept: 'application/json',
            'Content-Type': 'application/x-www-form-urlencoded',
            Authorization: 'Basic ' + auth,
        },
        form: {
            token: revokeToken
        }
    };

    return new Promise((resolve, reject) => {
        try {
            request.post(postBody, (function(e, r, data) {
                if (r && r.statusCode === 200) {
                    this.refreshToken = null;
                    this.token = null;
                    this.realmId = null;
                }
                resolve(data);
            }).bind(this));
        } catch (e) {
            reject(e);
        }
    });
};

/**
 * Get user info (OAuth2).
 *
 */
QuickBooks.prototype.getUserInfo = function() {
    return module.request(this, 'get', {url: QuickBooks.USER_INFO_URL}, null);
};

/**
 * Batch operation to enable an application to perform multiple operations in a single request.
 * The following batch items are supported:
 create
 update
 delete
 query
 * The maximum number of batch items in a single request is 30.
 *
 * @param  {object} items - JavaScript array of batch items

 */
QuickBooks.prototype.batch = function(items) {
    return module.request(this, 'post', {url: '/batch'}, {BatchItemRequest: items})
}

/**
 * The change data capture (CDC) operation returns a list of entities that have changed since a specified time.
 *
 * @param  {object} entities - Comma separated list or JavaScript array of entities to search for changes
 * @param  {object} since - JavaScript Date or string representation of the form '2012-07-20T22:25:51-07:00' to look back for changes until

 */
QuickBooks.prototype.changeDataCapture = function(entities, since) {
    var url = '/cdc?entities='
    url += typeof entities === 'string' ? entities : entities.join(',')
    url += '&changedSince='
    url += typeof since === 'string' ? since : formatISO(since)
    return module.request(this, 'get', {url: url}, null)
}

/**
 * Uploads a file as an Attachable in QBO, optionally linking it to the specified
 * QBO Entity.
 *
 * @param  {string} filename - the name of the file
 * @param  {string} contentType - the mime type of the file
 * @param  {object} stream - ReadableStream of file contents
 * @param  {object} entityType - optional string name of the QBO entity the Attachable will be linked to (e.g. Invoice)
 * @param  {object} entityId - optional Id of the QBO entity the Attachable will be linked to

 */
QuickBooks.prototype.upload = async function({ filename, contentType, stream, entityType, entityId }) {
    var that = this
    var opts = {
        url: '/upload',
        formData: {
            file_content_01: {
                value: stream,
                options: {
                    filename: filename,
                    contentType: contentType
                }
            }
        }
    }
    const data = await module.request(this, 'post', opts, null);
    if (data[0].Fault) {
        throw data[0];
    }
    var id = data[0].Attachable.Id
    return await that.updateAttachable({
        Id: id,
        SyncToken: '0',
        AttachableRef: [{
            EntityRef: {
                type: entityType,
                value: entityId + ''
            }
        }]
    });
}

/**
 * Creates the Account in QuickBooks
 *
 * @param  {object} account - The unsaved account, to be persisted in QuickBooks

 */
QuickBooks.prototype.createAccount = function(account) {
    return module.create(this, 'account', account)
}

/**
 * Creates the Attachable in QuickBooks
 *
 * @param  {object} attachable - The unsaved attachable, to be persisted in QuickBooks

 */
QuickBooks.prototype.createAttachable = function(attachable) {
    return module.create(this, 'attachable', attachable)
}

/**
 * Creates the Bill in QuickBooks
 *
 * @param  {object} bill - The unsaved bill, to be persisted in QuickBooks

 */
QuickBooks.prototype.createBill = function(bill) {
    return module.create(this, 'bill', bill)
}

/**
 * Creates the BillPayment in QuickBooks
 *
 * @param  {object} billPayment - The unsaved billPayment, to be persisted in QuickBooks

 */
QuickBooks.prototype.createBillPayment = function(billPayment) {
    return module.create(this, 'billPayment', billPayment)
}

/**
 * Creates the Class in QuickBooks
 *
 * @param  {object} class - The unsaved class, to be persisted in QuickBooks

 */
QuickBooks.prototype.createClass = function(klass) {
    return module.create(this, 'class', klass)
}

/**
 * Creates the CreditMemo in QuickBooks
 *
 * @param  {object} creditMemo - The unsaved creditMemo, to be persisted in QuickBooks

 */
QuickBooks.prototype.createCreditMemo = function(creditMemo) {
    return module.create(this, 'creditMemo', creditMemo)
}

/**
 * Creates the Customer in QuickBooks
 *
 * @param  {object} customer - The unsaved customer, to be persisted in QuickBooks

 */
QuickBooks.prototype.createCustomer = function(customer) {
    return module.create(this, 'customer', customer)
}

/**
 * Creates the Department in QuickBooks
 *
 * @param  {object} department - The unsaved department, to be persisted in QuickBooks

 */
QuickBooks.prototype.createDepartment = function(department) {
    return module.create(this, 'department', department)
}

/**
 * Creates the Deposit in QuickBooks
 *
 * @param  {object} deposit - The unsaved Deposit, to be persisted in QuickBooks

 */
QuickBooks.prototype.createDeposit = function(deposit) {
    return module.create(this, 'deposit', deposit)
}

/**
 * Creates the Employee in QuickBooks
 *
 * @param  {object} employee - The unsaved employee, to be persisted in QuickBooks

 */
QuickBooks.prototype.createEmployee = function(employee) {
    return module.create(this, 'employee', employee)
}

/**
 * Creates the Estimate in QuickBooks
 *
 * @param  {object} estimate - The unsaved estimate, to be persisted in QuickBooks

 */
QuickBooks.prototype.createEstimate = function(estimate) {
    return module.create(this, 'estimate', estimate)
}

/**
 * Creates the Invoice in QuickBooks
 *
 * @param  {object} invoice - The unsaved invoice, to be persisted in QuickBooks

 */
QuickBooks.prototype.createInvoice = function(invoice) {
    return module.create(this, 'invoice', invoice)
}

/**
 * Creates the Item in QuickBooks
 *
 * @param  {object} item - The unsaved item, to be persisted in QuickBooks

 */
QuickBooks.prototype.createItem = function(item) {
    return module.create(this, 'item', item)
}

/**
 * Creates the JournalCode in QuickBooks
 *
 * @param  {object} journalCode - The unsaved journalCode, to be persisted in QuickBooks

 */
QuickBooks.prototype.createJournalCode = function(journalCode) {
    return module.create(this, 'journalCode', journalCode)
}

/**
 * Creates the JournalEntry in QuickBooks
 *
 * @param  {object} journalEntry - The unsaved journalEntry, to be persisted in QuickBooks

 */
QuickBooks.prototype.createJournalEntry = function(journalEntry) {
    return module.create(this, 'journalEntry', journalEntry)
}

/**
 * Creates the Payment in QuickBooks
 *
 * @param  {object} payment - The unsaved payment, to be persisted in QuickBooks

 */
QuickBooks.prototype.createPayment = function(payment) {
    return module.create(this, 'payment', payment)
}

/**
 * Creates the PaymentMethod in QuickBooks
 *
 * @param  {object} paymentMethod - The unsaved paymentMethod, to be persisted in QuickBooks

 */
QuickBooks.prototype.createPaymentMethod = function(paymentMethod) {
    return module.create(this, 'paymentMethod', paymentMethod)
}

/**
 * Creates the Purchase in QuickBooks
 *
 * @param  {object} purchase - The unsaved purchase, to be persisted in QuickBooks

 */
QuickBooks.prototype.createPurchase = function(purchase) {
    return module.create(this, 'purchase', purchase)
}

/**
 * Creates the PurchaseOrder in QuickBooks
 *
 * @param  {object} purchaseOrder - The unsaved purchaseOrder, to be persisted in QuickBooks

 */
QuickBooks.prototype.createPurchaseOrder = function(purchaseOrder) {
    return module.create(this, 'purchaseOrder', purchaseOrder)
}

/**
 * Creates the RefundReceipt in QuickBooks
 *
 * @param  {object} refundReceipt - The unsaved refundReceipt, to be persisted in QuickBooks

 */
QuickBooks.prototype.createRefundReceipt = function(refundReceipt) {
    return module.create(this, 'refundReceipt', refundReceipt)
}

/**
 * Creates the SalesReceipt in QuickBooks
 *
 * @param  {object} salesReceipt - The unsaved salesReceipt, to be persisted in QuickBooks

 */
QuickBooks.prototype.createSalesReceipt = function(salesReceipt) {
    return module.create(this, 'salesReceipt', salesReceipt)
}

/**
 * Creates the TaxAgency in QuickBooks
 *
 * @param  {object} taxAgency - The unsaved taxAgency, to be persisted in QuickBooks

 */
QuickBooks.prototype.createTaxAgency = function(taxAgency) {
    return module.create(this, 'taxAgency', taxAgency)
}

/**
 * Creates the TaxService in QuickBooks
 *
 * @param  {object} taxService - The unsaved taxService, to be persisted in QuickBooks

 */
QuickBooks.prototype.createTaxService = function(taxService) {
    return module.create(this, 'taxService/taxcode', taxService)
}

/**
 * Creates the Term in QuickBooks
 *
 * @param  {object} term - The unsaved term, to be persisted in QuickBooks

 */
QuickBooks.prototype.createTerm = function(term) {
    return module.create(this, 'term', term)
}

/**
 * Creates the TimeActivity in QuickBooks
 *
 * @param  {object} timeActivity - The unsaved timeActivity, to be persisted in QuickBooks

 */
QuickBooks.prototype.createTimeActivity = function(timeActivity) {
    return module.create(this, 'timeActivity', timeActivity)
}

/**
 * Creates the Transfer in QuickBooks
 *
 * @param  {object} transfer - The unsaved Transfer, to be persisted in QuickBooks

 */
QuickBooks.prototype.createTransfer = function(transfer) {
    return module.create(this, 'transfer', transfer)
}

/**
 * Creates the Vendor in QuickBooks
 *
 * @param  {object} vendor - The unsaved vendor, to be persisted in QuickBooks

 */
QuickBooks.prototype.createVendor = function(vendor) {
    return module.create(this, 'vendor', vendor)
}

/**
 * Creates the VendorCredit in QuickBooks
 *
 * @param  {object} vendorCredit - The unsaved vendorCredit, to be persisted in QuickBooks

 */
QuickBooks.prototype.createVendorCredit = function(vendorCredit) {
    return module.create(this, 'vendorCredit', vendorCredit)
}



/**
 * Retrieves the Account from QuickBooks
 *
 * @param  {string} id - The Id of persistent Account

 */
QuickBooks.prototype.getAccount = function(id) {
    return module.read(this, 'account', id)
}

/**
 * Retrieves the Attachable from QuickBooks
 *
 * @param  {string} id - The Id of persistent Attachable

 */
QuickBooks.prototype.getAttachable = function(id) {
    return module.read(this, 'attachable', id)
}

/**
 * Retrieves the Bill from QuickBooks
 *
 * @param  {string} id - The Id of persistent Bill

 */
QuickBooks.prototype.getBill = function(id) {
    return module.read(this, 'bill', id)
}

/**
 * Retrieves the BillPayment from QuickBooks
 *
 * @param  {string} id - The Id of persistent BillPayment

 */
QuickBooks.prototype.getBillPayment = function(id) {
    return module.read(this, 'billPayment', id)
}

/**
 * Retrieves the Class from QuickBooks
 *
 * @param  {string} id - The Id of persistent Class

 */
QuickBooks.prototype.getClass = function(id) {
    return module.read(this, 'class', id)
}

/**
 * Retrieves the CompanyInfo from QuickBooks
 *
 * @param  {string} id - The Id of persistent CompanyInfo

 */
QuickBooks.prototype.getCompanyInfo = function(id) {
    return module.read(this, 'companyInfo', id)
}

/**
 * Retrieves the CompanyCurrency from QuickBooks
 *
 * @param  {string} id - The Id of persistent CompanyCurrency

 */
QuickBooks.prototype.getCompanyCurrency = function(id) {
    return module.read(this, 'companyCurrency', id)
}

/**
 * Retrieves the CreditMemo from QuickBooks
 *
 * @param  {string} id - The Id of persistent CreditMemo

 */
QuickBooks.prototype.getCreditMemo = function(id) {
    return module.read(this, 'creditMemo', id)
}

/**
 * Retrieves the Customer from QuickBooks
 *
 * @param  {string} id - The Id of persistent Customer

 */
QuickBooks.prototype.getCustomer = function(id) {
    return module.read(this, 'customer', id)
}

/**
 * Retrieves the CustomerType from QuickBooks
 *
 * @param  {string} id - The Id of persistent CustomerType

 */
QuickBooks.prototype.getCustomerType = function(id) {
    return module.read(this, 'customerType', id)
}

/**
 * Retrieves the Department from QuickBooks
 *
 * @param  {string} id - The Id of persistent Department

 */
QuickBooks.prototype.getDepartment = function(id) {
    return module.read(this, 'department', id)
}

/**
 * Retrieves the Deposit from QuickBooks
 *
 * @param  {string} id - The Id of persistent Deposit

 */
QuickBooks.prototype.getDeposit = function(id) {
    return module.read(this, 'deposit', id)
}

/**
 * Retrieves the Employee from QuickBooks
 *
 * @param  {string} id - The Id of persistent Employee

 */
QuickBooks.prototype.getEmployee = function(id) {
    return module.read(this, 'employee', id)
}

/**
 * Retrieves the Estimate from QuickBooks
 *
 * @param  {string} id - The Id of persistent Estimate

 */
QuickBooks.prototype.getEstimate = function(id) {
    return module.read(this, 'estimate', id)
}

/**
 * Retrieves an ExchangeRate from QuickBooks
 *
 * @param  {object} options - An object with options including the required `sourcecurrencycode` parameter and optional `asofdate` parameter.

 */
QuickBooks.prototype.getExchangeRate = function(options) {
    var url = "/exchangerate";
    return module.request(this, 'get', {url: url, qs: options}, null)
}


/**
 * Retrieves the Estimate PDF from QuickBooks
 *
 * @param  {string} id - The Id of persistent Estimate

 */
QuickBooks.prototype.getEstimatePdf = function(id) {
    return module.read(this, 'Estimate', id + '/pdf')
};

/**
 * Emails the Estimate PDF from QuickBooks to the address supplied in Estimate.BillEmail.EmailAddress
 * or the specified 'sendTo' address
 *
 * @param  {string} id - The Id of persistent Estimate
 * @param  {string} sendTo - optional email address to send the PDF to. If not provided, address supplied in Estimate.BillEmail.EmailAddress will be used

 */
QuickBooks.prototype.sendEstimatePdf = function(id, sendTo) {
    var path = '/estimate/' + id + '/send'
    callback = _.isFunction(sendTo) ? sendTo : callback
    if (sendTo && ! _.isFunction(sendTo)) {
        path += '?sendTo=' + sendTo
    }
    return module.request(this, 'post', {url: path}, null, module.unwrap(callback, 'Estimate'))
}

/**
 * Retrieves the Invoice from QuickBooks
 *
 * @param  {string} id - The Id of persistent Invoice

 */
QuickBooks.prototype.getInvoice = function(id) {
    return module.read(this, 'invoice', id)
}

/**
 * Retrieves the Invoice PDF from QuickBooks
 *
 * @param  {string} id - The Id of persistent Invoice

 */
QuickBooks.prototype.getInvoicePdf = function(id) {
    return module.read(this, 'Invoice', id + '/pdf', callback)
}

/**
 * Emails the Invoice PDF from QuickBooks to the address supplied in Invoice.BillEmail.EmailAddress
 * or the specified 'sendTo' address
 *
 * @param  {string} id - The Id of persistent Invoice
 * @param  {string} sendTo - optional email address to send the PDF to. If not provided, address supplied in Invoice.BillEmail.EmailAddress will be used

 */
QuickBooks.prototype.sendInvoicePdf = function(id, sendTo) {
    var path = '/invoice/' + id + '/send'
    callback = _.isFunction(sendTo) ? sendTo : callback
    if (sendTo && ! _.isFunction(sendTo)) {
        path += '?sendTo=' + sendTo
    }
    return module.request(this, 'post', {url: path}, null, module.unwrap(callback, 'Invoice'))
}

/**
 * Retrieves the Credit Memo PDF from QuickBooks
 *
 * @param  {string} id - The Id of persistent Credit Memo

 */
QuickBooks.prototype.getCreditMemoPdf = function(id) {
    return module.read(this, 'CreditMemo', id + '/pdf')
}

/**
 * Emails the Credit Memo PDF from QuickBooks to the address supplied in CreditMemo.BillEmail.EmailAddress
 * or the specified 'sendTo' address
 *
 * @param  {string} id - The Id of persistent Credit Memo
 * @param  {string} sendTo - optional email address to send the PDF to. If not provided, address supplied in CreditMemo.BillEmail.EmailAddress will be used

 */
QuickBooks.prototype.sendCreditMemoPdf = function(id, sendTo) {
    var path = '/creditmemo/' + id + '/send'
    callback = _.isFunction(sendTo) ? sendTo : callback
    if (sendTo && ! _.isFunction(sendTo)) {
        path += '?sendTo=' + sendTo
    }
    return module.request(this, 'post', {url: path}, null, module.unwrap(callback, 'CreditMemo'))
}

/**
 * Emails the Purchase Order from QuickBooks to the address supplied in PurchaseOrder.POEmail.Address
 * or the specified 'sendTo' address
 *
 * @param  {string} id - The Id of persistent Purchase Order
 * @param  {string} sendTo - optional email address to send the PDF to. If not provided, address supplied in PurchaseOrder.POEmail.Address will be used

 */
QuickBooks.prototype.sendPurchaseOrder = function(id, sendTo) {
    var path = '/purchaseorder/' + id + '/send'
    callback = _.isFunction(sendTo) ? sendTo : callback
    if (sendTo && ! _.isFunction(sendTo)) {
        path += '?sendTo=' + sendTo
    }
    return module.request(this, 'post', {url: path}, null, module.unwrap(callback, 'PurchaseOrder'))
}

/**
 * Retrieves the Item from QuickBooks
 *
 * @param  {string} id - The Id of persistent Item

 */
QuickBooks.prototype.getItem = function(id) {
    return module.read(this, 'item', id)
}

/**
 * Retrieves the JournalCode from QuickBooks
 *
 * @param  {string} id - The Id of persistent JournalCode

 */
QuickBooks.prototype.getJournalCode = function(id) {
    return module.read(this, 'journalCode', id)
}

/**
 * Retrieves the JournalEntry from QuickBooks
 *
 * @param  {string} id - The Id of persistent JournalEntry

 */
QuickBooks.prototype.getJournalEntry = function(id) {
    return module.read(this, 'journalEntry', id)
}

/**
 * Retrieves the Payment from QuickBooks
 *
 * @param  {string} id - The Id of persistent Payment

 */
QuickBooks.prototype.getPayment = function(id) {
    return module.read(this, 'payment', id)
}

/**
 * Retrieves the PaymentMethod from QuickBooks
 *
 * @param  {string} id - The Id of persistent PaymentMethod

 */
QuickBooks.prototype.getPaymentMethod = function(id) {
    return module.read(this, 'paymentMethod', id)
}

/**
 * Retrieves the Preferences from QuickBooks
 *

 */
QuickBooks.prototype.getPreferences = function(callback) {
    return module.read(this, 'preferences', null)
}

/**
 * Retrieves the Purchase from QuickBooks
 *
 * @param  {string} id - The Id of persistent Purchase

 */
QuickBooks.prototype.getPurchase = function(id) {
    return module.read(this, 'purchase', id)
}

/**
 * Retrieves the PurchaseOrder from QuickBooks
 *
 * @param  {string} id - The Id of persistent PurchaseOrder

 */
QuickBooks.prototype.getPurchaseOrder = function(id) {
    return module.read(this, 'purchaseOrder', id)
}

/**
 * Retrieves the RefundReceipt from QuickBooks
 *
 * @param  {string} id - The Id of persistent RefundReceipt

 */
QuickBooks.prototype.getRefundReceipt = function(id) {
    return module.read(this, 'refundReceipt', id)
}

/**
 * Retrieves the Reports from QuickBooks
 *
 * @param  {string} id - The Id of persistent Reports
 */
QuickBooks.prototype.getReports = function(id) {
    return module.read(this, 'reports', id)
}

/**
 * Retrieves the SalesReceipt from QuickBooks
 *
 * @param  {string} id - The Id of persistent SalesReceipt
 */
QuickBooks.prototype.getSalesReceipt = function(id) {
    return module.read(this, 'salesReceipt', id)
}

/**
 * Retrieves the SalesReceipt PDF from QuickBooks
 *
 * @param  {string} id - The Id of persistent SalesReceipt
 */
QuickBooks.prototype.getSalesReceiptPdf = function(id) {
    return module.read(this, 'salesReceipt', id + '/pdf')
}

/**
 * Emails the SalesReceipt PDF from QuickBooks to the address supplied in SalesReceipt.BillEmail.EmailAddress
 * or the specified 'sendTo' address
 *
 * @param  {string} id - The Id of persistent SalesReceipt
 * @param  {string} sendTo - optional email address to send the PDF to. If not provided, address supplied in SalesReceipt.BillEmail.EmailAddress will be used
 */
QuickBooks.prototype.sendSalesReceiptPdf = function(id, sendTo) {
    var path = '/salesreceipt/' + id + '/send'
    if (sendTo && ! _.isFunction(sendTo)) {
        path += '?sendTo=' + sendTo
    }
    return module.request(this, 'post', {url: path}, null)
}

/**
 * Retrieves the TaxAgency from QuickBooks
 *
 * @param  {string} id - The Id of persistent TaxAgency
 */
QuickBooks.prototype.getTaxAgency = function(id) {
    return module.read(this, 'taxAgency', id)
}

/**
 * Retrieves the TaxCode from QuickBooks
 *
 * @param  {string} id - The Id of persistent TaxCode
 */
QuickBooks.prototype.getTaxCode = function(id) {
    return module.read(this, 'taxCode', id)
}

/**
 * Retrieves the TaxRate from QuickBooks
 *
 * @param  {string} id - The Id of persistent TaxRate

 */
QuickBooks.prototype.getTaxRate = function(id) {
    return module.read(this, 'taxRate', id)
}

/**
 * Retrieves the Term from QuickBooks
 *
 * @param  {string} id - The Id of persistent Term

 */
QuickBooks.prototype.getTerm = function(id) {
    return module.read(this, 'term', id)
}

/**
 * Retrieves the TimeActivity from QuickBooks
 *
 * @param  {string} id - The Id of persistent TimeActivity

 */
QuickBooks.prototype.getTimeActivity = function(id) {
    return module.read(this, 'timeActivity', id)
}

/**
 * Retrieves the Transfer from QuickBooks
 *
 * @param  {string} id - The Id of persistent Term

 */
QuickBooks.prototype.getTransfer = function(id) {
    return module.read(this, 'transfer', id)
}

/**
 * Retrieves the Vendor from QuickBooks
 *
 * @param  {string} id - The Id of persistent Vendor

 */
QuickBooks.prototype.getVendor = function(id) {
    return module.read(this, 'vendor', id)
}

/**
 * Retrieves the VendorCredit from QuickBooks
 *
 * @param  {string} id - The Id of persistent VendorCredit

 */
QuickBooks.prototype.getVendorCredit = function(id) {
    return module.read(this, 'vendorCredit', id)
}



/**
 * Updates QuickBooks version of Account
 *
 * @param  {object} account - The persistent Account, including Id and SyncToken fields

 */
QuickBooks.prototype.updateAccount = function(account) {
    return module.update(this, 'account', account)
}

/**
 * Updates QuickBooks version of Attachable
 *
 * @param  {object} attachable - The persistent Attachable, including Id and SyncToken fields

 */
QuickBooks.prototype.updateAttachable = function(attachable) {
    return module.update(this, 'attachable', attachable)
}

/**
 * Updates QuickBooks version of Bill
 *
 * @param  {object} bill - The persistent Bill, including Id and SyncToken fields

 */
QuickBooks.prototype.updateBill = function(bill) {
    return module.update(this, 'bill', bill)
}

/**
 * Updates QuickBooks version of BillPayment
 *
 * @param  {object} billPayment - The persistent BillPayment, including Id and SyncToken fields

 */
QuickBooks.prototype.updateBillPayment = function(billPayment) {
    return module.update(this, 'billPayment', billPayment)
}

/**
 * Updates QuickBooks version of Class
 *
 * @param  {object} class - The persistent Class, including Id and SyncToken fields

 */
QuickBooks.prototype.updateClass = function(klass) {
    return module.update(this, 'class', klass)
}

/**
 * Updates QuickBooks version of CompanyInfo
 *
 * @param  {object} companyInfo - The persistent CompanyInfo, including Id and SyncToken fields

 */
QuickBooks.prototype.updateCompanyInfo = function(companyInfo) {
    return module.update(this, 'companyInfo', companyInfo)
}

/**
 * Updates QuickBooks version of CreditMemo
 *
 * @param  {object} creditMemo - The persistent CreditMemo, including Id and SyncToken fields

 */
QuickBooks.prototype.updateCreditMemo = function(creditMemo) {
    return module.update(this, 'creditMemo', creditMemo)
}

/**
 * Updates QuickBooks version of Customer
 *
 * @param  {object} customer - The persistent Customer, including Id and SyncToken fields

 */
QuickBooks.prototype.updateCustomer = function(customer) {
    return module.update(this, 'customer', customer)
}

/**
 * Updates QuickBooks version of Department
 *
 * @param  {object} department - The persistent Department, including Id and SyncToken fields

 */
QuickBooks.prototype.updateDepartment = function(department) {
    return module.update(this, 'department', department)
}

/**
 * Updates QuickBooks version of Deposit
 *
 * @param  {object} deposit - The persistent Deposit, including Id and SyncToken fields

 */
QuickBooks.prototype.updateDeposit = function(deposit) {
    return module.update(this, 'deposit', deposit)
}

/**
 * Updates QuickBooks version of Employee
 *
 * @param  {object} employee - The persistent Employee, including Id and SyncToken fields

 */
QuickBooks.prototype.updateEmployee = function(employee) {
    return module.update(this, 'employee', employee)
}

/**
 * Updates QuickBooks version of Estimate
 *
 * @param  {object} estimate - The persistent Estimate, including Id and SyncToken fields

 */
QuickBooks.prototype.updateEstimate = function(estimate) {
    return module.update(this, 'estimate', estimate)
}

/**
 * Updates QuickBooks version of Invoice
 *
 * @param  {object} invoice - The persistent Invoice, including Id and SyncToken fields

 */
QuickBooks.prototype.updateInvoice = function(invoice) {
    return module.update(this, 'invoice', invoice)
}

/**
 * Updates QuickBooks version of Item
 *
 * @param  {object} item - The persistent Item, including Id and SyncToken fields

 */
QuickBooks.prototype.updateItem = function(item) {
    return module.update(this, 'item', item)
}

/**
 * Updates QuickBooks version of JournalCode
 *
 * @param  {object} journalCode - The persistent JournalCode, including Id and SyncToken fields

 */
QuickBooks.prototype.updateJournalCode = function(journalCode) {
    return module.update(this, 'journalCode', journalCode)
}

/**
 * Updates QuickBooks version of JournalEntry
 *
 * @param  {object} journalEntry - The persistent JournalEntry, including Id and SyncToken fields

 */
QuickBooks.prototype.updateJournalEntry = function(journalEntry) {
    return module.update(this, 'journalEntry', journalEntry)
}

/**
 * Updates QuickBooks version of Payment
 *
 * @param  {object} payment - The persistent Payment, including Id and SyncToken fields

 */
QuickBooks.prototype.updatePayment = function(payment) {
    return module.update(this, 'payment', payment)
}

/**
 * Updates QuickBooks version of PaymentMethod
 *
 * @param  {object} paymentMethod - The persistent PaymentMethod, including Id and SyncToken fields

 */
QuickBooks.prototype.updatePaymentMethod = function(paymentMethod) {
    return module.update(this, 'paymentMethod', paymentMethod)
}

/**
 * Updates QuickBooks version of Preferences
 *
 * @param  {object} preferences - The persistent Preferences, including Id and SyncToken fields

 */
QuickBooks.prototype.updatePreferences = function(preferences) {
    return module.update(this, 'preferences', preferences)
}

/**
 * Updates QuickBooks version of Purchase
 *
 * @param  {object} purchase - The persistent Purchase, including Id and SyncToken fields

 */
QuickBooks.prototype.updatePurchase = function(purchase) {
    return module.update(this, 'purchase', purchase)
}

/**
 * Updates QuickBooks version of PurchaseOrder
 *
 * @param  {object} purchaseOrder - The persistent PurchaseOrder, including Id and SyncToken fields

 */
QuickBooks.prototype.updatePurchaseOrder = function(purchaseOrder) {
    return module.update(this, 'purchaseOrder', purchaseOrder)
}

/**
 * Updates QuickBooks version of RefundReceipt
 *
 * @param  {object} refundReceipt - The persistent RefundReceipt, including Id and SyncToken fields

 */
QuickBooks.prototype.updateRefundReceipt = function(refundReceipt) {
    return module.update(this, 'refundReceipt', refundReceipt)
}

/**
 * Updates QuickBooks version of SalesReceipt
 *
 * @param  {object} salesReceipt - The persistent SalesReceipt, including Id and SyncToken fields

 */
QuickBooks.prototype.updateSalesReceipt = function(salesReceipt) {
    return module.update(this, 'salesReceipt', salesReceipt)
}

/**
 * Updates QuickBooks version of TaxAgency
 *
 * @param  {object} taxAgency - The persistent TaxAgency, including Id and SyncToken fields

 */
QuickBooks.prototype.updateTaxAgency = function(taxAgency) {
    return module.update(this, 'taxAgency', taxAgency)
}

/**
 * Updates QuickBooks version of TaxCode
 *
 * @param  {object} taxCode - The persistent TaxCode, including Id and SyncToken fields

 */
QuickBooks.prototype.updateTaxCode = function(taxCode) {
    return module.update(this, 'taxCode', taxCode)
}

/**
 * Updates QuickBooks version of TaxRate
 *
 * @param  {object} taxRate - The persistent TaxRate, including Id and SyncToken fields

 */
QuickBooks.prototype.updateTaxRate = function(taxRate) {
    return module.update(this, 'taxRate', taxRate)
}

/**
 * Updates QuickBooks version of Term
 *
 * @param  {object} term - The persistent Term, including Id and SyncToken fields

 */
QuickBooks.prototype.updateTerm = function(term) {
    return module.update(this, 'term', term)
}

/**
 * Updates QuickBooks version of TimeActivity
 *
 * @param  {object} timeActivity - The persistent TimeActivity, including Id and SyncToken fields

 */
QuickBooks.prototype.updateTimeActivity = function(timeActivity) {
    return module.update(this, 'timeActivity', timeActivity)
}

/**
 * Updates QuickBooks version of Transfer
 *
 * @param  {object} transfer - The persistent Transfer, including Id and SyncToken fields

 */
QuickBooks.prototype.updateTransfer = function(transfer) {
    return module.update(this, 'transfer', transfer)
}

/**
 * Updates QuickBooks version of Vendor
 *
 * @param  {object} vendor - The persistent Vendor, including Id and SyncToken fields

 */
QuickBooks.prototype.updateVendor = function(vendor) {
    return module.update(this, 'vendor', vendor)
}

/**
 * Updates QuickBooks version of VendorCredit
 *
 * @param  {object} vendorCredit - The persistent VendorCredit, including Id and SyncToken fields

 */
QuickBooks.prototype.updateVendorCredit = function(vendorCredit) {
    return module.update(this, 'vendorCredit', vendorCredit)
}

/**
 * Updates QuickBooks version of ExchangeRate
 *
 * @param  {object} exchangeRate - The persistent ExchangeRate, including Id and SyncToken fields

 */
QuickBooks.prototype.updateExchangeRate = function(exchangeRate) {
    return module.update(this, 'exchangerate', exchangeRate)
}


/**
 * Deletes the Attachable from QuickBooks
 *
 * @param  {object} idOrEntity - The persistent Attachable to be deleted, or the Id of the Attachable, in which case an extra GET request will be issued to first retrieve the Attachable

 */
QuickBooks.prototype.deleteAttachable = function(idOrEntity) {
    return module.delete(this, 'attachable', idOrEntity)
}

/**
 * Deletes the Bill from QuickBooks
 *
 * @param  {object} idOrEntity - The persistent Bill to be deleted, or the Id of the Bill, in which case an extra GET request will be issued to first retrieve the Bill

 */
QuickBooks.prototype.deleteBill = function(idOrEntity) {
    return module.delete(this, 'bill', idOrEntity)
}

/**
 * Deletes the BillPayment from QuickBooks
 *
 * @param  {object} idOrEntity - The persistent BillPayment to be deleted, or the Id of the BillPayment, in which case an extra GET request will be issued to first retrieve the BillPayment

 */
QuickBooks.prototype.deleteBillPayment = function(idOrEntity) {
    return module.delete(this, 'billPayment', idOrEntity)
}

/**
 * Deletes the CreditMemo from QuickBooks
 *
 * @param  {object} idOrEntity - The persistent CreditMemo to be deleted, or the Id of the CreditMemo, in which case an extra GET request will be issued to first retrieve the CreditMemo

 */
QuickBooks.prototype.deleteCreditMemo = function(idOrEntity) {
    return module.delete(this, 'creditMemo', idOrEntity)
}

/**
 * Deletes the Deposit from QuickBooks
 *
 * @param  {object} idOrEntity - The persistent Deposit to be deleted, or the Id of the Deposit, in which case an extra GET request will be issued to first retrieve the Deposit

 */
QuickBooks.prototype.deleteDeposit = function(idOrEntity) {
    return module.delete(this, 'deposit', idOrEntity)
}

/**
 * Deletes the Estimate from QuickBooks
 *
 * @param  {object} idOrEntity - The persistent Estimate to be deleted, or the Id of the Estimate, in which case an extra GET request will be issued to first retrieve the Estimate

 */
QuickBooks.prototype.deleteEstimate = function(idOrEntity) {
    return module.delete(this, 'estimate', idOrEntity)
}

/**
 * Deletes the Invoice from QuickBooks
 *
 * @param  {object} idOrEntity - The persistent Invoice to be deleted, or the Id of the Invoice, in which case an extra GET request will be issued to first retrieve the Invoice

 */
QuickBooks.prototype.deleteInvoice = function(idOrEntity) {
    return module.delete(this, 'invoice', idOrEntity)
}

/**
 * Deletes the JournalCode from QuickBooks
 *
 * @param  {object} idOrEntity - The persistent JournalCode to be deleted, or the Id of the JournalCode, in which case an extra GET request will be issued to first retrieve the JournalCode

 */
QuickBooks.prototype.deleteJournalCode = function(idOrEntity) {
    return module.delete(this, 'journalCode', idOrEntity)
}

/**
 * Deletes the JournalEntry from QuickBooks
 *
 * @param  {object} idOrEntity - The persistent JournalEntry to be deleted, or the Id of the JournalEntry, in which case an extra GET request will be issued to first retrieve the JournalEntry

 */
QuickBooks.prototype.deleteJournalEntry = function(idOrEntity) {
    return module.delete(this, 'journalEntry', idOrEntity)
}

/**
 * Deletes the Payment from QuickBooks
 *
 * @param  {object} idOrEntity - The persistent Payment to be deleted, or the Id of the Payment, in which case an extra GET request will be issued to first retrieve the Payment

 */
QuickBooks.prototype.deletePayment = function(idOrEntity) {
    return module.delete(this, 'payment', idOrEntity)
}

/**
 * Deletes the Purchase from QuickBooks
 *
 * @param  {object} idOrEntity - The persistent Purchase to be deleted, or the Id of the Purchase, in which case an extra GET request will be issued to first retrieve the Purchase

 */
QuickBooks.prototype.deletePurchase = function(idOrEntity) {
    return module.delete(this, 'purchase', idOrEntity)
}

/**
 * Deletes the PurchaseOrder from QuickBooks
 *
 * @param  {object} idOrEntity - The persistent PurchaseOrder to be deleted, or the Id of the PurchaseOrder, in which case an extra GET request will be issued to first retrieve the PurchaseOrder

 */
QuickBooks.prototype.deletePurchaseOrder = function(idOrEntity) {
    return module.delete(this, 'purchaseOrder', idOrEntity)
}

/**
 * Deletes the RefundReceipt from QuickBooks
 *
 * @param  {object} idOrEntity - The persistent RefundReceipt to be deleted, or the Id of the RefundReceipt, in which case an extra GET request will be issued to first retrieve the RefundReceipt

 */
QuickBooks.prototype.deleteRefundReceipt = function(idOrEntity) {
    return module.delete(this, 'refundReceipt', idOrEntity)
}

/**
 * Deletes the SalesReceipt from QuickBooks
 *
 * @param  {object} idOrEntity - The persistent SalesReceipt to be deleted, or the Id of the SalesReceipt, in which case an extra GET request will be issued to first retrieve the SalesReceipt

 */
QuickBooks.prototype.deleteSalesReceipt = function(idOrEntity) {
    return module.delete(this, 'salesReceipt', idOrEntity)
}

/**
 * Deletes the TimeActivity from QuickBooks
 *
 * @param  {object} idOrEntity - The persistent TimeActivity to be deleted, or the Id of the TimeActivity, in which case an extra GET request will be issued to first retrieve the TimeActivity

 */
QuickBooks.prototype.deleteTimeActivity = function(idOrEntity) {
    return module.delete(this, 'timeActivity', idOrEntity)
}

/**
 * Deletes the Transfer from QuickBooks
 *
 * @param  {object} idOrEntity - The persistent Transfer to be deleted, or the Id of the Transfer, in which case an extra GET request will be issued to first retrieve the Transfer

 */
QuickBooks.prototype.deleteTransfer = function(idOrEntity) {
    return module.delete(this, 'transfer', idOrEntity)
}

/**
 * Deletes the VendorCredit from QuickBooks
 *
 * @param  {object} idOrEntity - The persistent VendorCredit to be deleted, or the Id of the VendorCredit, in which case an extra GET request will be issued to first retrieve the VendorCredit

 */
QuickBooks.prototype.deleteVendorCredit = function(idOrEntity) {
    return module.delete(this, 'vendorCredit', idOrEntity)
}



/**
 * Voids the Invoice from QuickBooks
 *
 * @param  {object} idOrEntity - The persistent Invoice to be voided, or the Id of the Invoice, in which case an extra GET request will be issued to first retrieve the Invoice

 */
QuickBooks.prototype.voidInvoice = function (idOrEntity) {
    return module.void(this, 'invoice', idOrEntity)
}

/**
 * Voids QuickBooks version of Payment
 *
 * @param  {object} payment - The persistent Payment, including Id and SyncToken fields

 */
QuickBooks.prototype.voidPayment = function (payment) {
    payment.void = true;
    payment.sparse = true;
    return module.update(this, 'payment', payment)
}


/**
 * Finds all Accounts in QuickBooks, optionally matching the specified criteria
 *
 * @param  {object} criteria - (Optional) String or single-valued map converted to a where clause of the form "where key = 'value'"

 */
QuickBooks.prototype.findAccounts = function(criteria) {
    return module.query(this, 'account', criteria)
}

/**
 * Finds all Attachables in QuickBooks, optionally matching the specified criteria
 *
 * @param  {object} criteria - (Optional) String or single-valued map converted to a where clause of the form "where key = 'value'"

 */
QuickBooks.prototype.findAttachables = function(criteria) {
    return module.query(this, 'attachable', criteria)
}

/**
 * Finds all Bills in QuickBooks, optionally matching the specified criteria
 *
 * @param  {object} criteria - (Optional) String or single-valued map converted to a where clause of the form "where key = 'value'"

 */
QuickBooks.prototype.findBills = function(criteria) {
    return module.query(this, 'bill', criteria)
}

/**
 * Finds all BillPayments in QuickBooks, optionally matching the specified criteria
 *
 * @param  {object} criteria - (Optional) String or single-valued map converted to a where clause of the form "where key = 'value'"

 */
QuickBooks.prototype.findBillPayments = function(criteria) {
    return module.query(this, 'billPayment', criteria)
}

/**
 * Finds all Budgets in QuickBooks, optionally matching the specified criteria
 *
 * @param  {object} criteria - (Optional) String or single-valued map converted to a where clause of the form "where key = 'value'"

 */
QuickBooks.prototype.findBudgets = function(criteria) {
    return module.query(this, 'budget', criteria)
}

/**
 * Finds all Classs in QuickBooks, optionally matching the specified criteria
 *
 * @param  {object} criteria - (Optional) String or single-valued map converted to a where clause of the form "where key = 'value'"

 */
QuickBooks.prototype.findClasses = function(criteria) {
    return module.query(this, 'class', criteria)
}

/**
 * Finds all CompanyInfos in QuickBooks, optionally matching the specified criteria
 *
 * @param  {object} criteria - (Optional) String or single-valued map converted to a where clause of the form "where key = 'value'"

 */
QuickBooks.prototype.findCompanyInfos = function(criteria) {
    return module.query(this, 'companyInfo', criteria)
}

/**
 * Finds all CompanyCurrencies in QuickBooks, optionally matching the specified criteria
 *
 * @param  {object} criteria - (Optional) String or single-valued map converted to a where clause of the form "where key = 'value'"

 */
QuickBooks.prototype.findCompanyCurrencies = function(criteria) {
    return module.query(this, 'companyCurrency', criteria)
}

/**
 * Finds all CreditMemos in QuickBooks, optionally matching the specified criteria
 *
 * @param  {object} criteria - (Optional) String or single-valued map converted to a where clause of the form "where key = 'value'"

 */
QuickBooks.prototype.findCreditMemos = function(criteria) {
    return module.query(this, 'creditMemo', criteria)
}

/**
 * Finds all Customers in QuickBooks, optionally matching the specified criteria
 *
 * @param  {object} criteria - (Optional) String or single-valued map converted to a where clause of the form "where key = 'value'"

 */
QuickBooks.prototype.findCustomers = function(criteria = undefined) {
    return module.query(this, 'customer', criteria)
}

/**
 * Finds all CustomerTypes in QuickBooks, optionally matching the specified criteria
 *
 * @param  {object} criteria - (Optional) String or single-valued map converted to a where clause of the form "where key = 'value'"

 */
QuickBooks.prototype.findCustomerTypes = function(criteria) {
    return module.query(this, 'customerType', criteria)
}

/**
 * Finds all Departments in QuickBooks, optionally matching the specified criteria
 *
 * @param  {object} criteria - (Optional) String or single-valued map converted to a where clause of the form "where key = 'value'"

 */
QuickBooks.prototype.findDepartments = function(criteria) {
    return module.query(this, 'department', criteria)
}

/**
 * Finds all Deposits in QuickBooks, optionally matching the specified criteria
 *
 * @param  {object} criteria - (Optional) String or single-valued map converted to a where clause of the form "where key = 'value'"

 */
QuickBooks.prototype.findDeposits = function(criteria) {
    return module.query(this, 'deposit', criteria)
}

/**
 * Finds all Employees in QuickBooks, optionally matching the specified criteria
 *
 * @param  {object} criteria - (Optional) String or single-valued map converted to a where clause of the form "where key = 'value'"

 */
QuickBooks.prototype.findEmployees = function(criteria) {
    return module.query(this, 'employee', criteria)
}

/**
 * Finds all Estimates in QuickBooks, optionally matching the specified criteria
 *
 * @param  {object} criteria - (Optional) String or single-valued map converted to a where clause of the form "where key = 'value'"

 */
QuickBooks.prototype.findEstimates = function(criteria) {
    return module.query(this, 'estimate', criteria)
}

/**
 * Finds all Invoices in QuickBooks, optionally matching the specified criteria
 *
 * @param  {object} criteria - (Optional) String or single-valued map converted to a where clause of the form "where key = 'value'"

 */
QuickBooks.prototype.findInvoices = function(criteria) {
    return module.query(this, 'invoice', criteria)
}

/**
 * Finds all Items in QuickBooks, optionally matching the specified criteria
 *
 * @param  {object} criteria - (Optional) String or single-valued map converted to a where clause of the form "where key = 'value'"

 */
QuickBooks.prototype.findItems = function(criteria) {
    return module.query(this, 'item', criteria)
}

/**
 * Finds all JournalCodes in QuickBooks, optionally matching the specified criteria
 *
 * @param  {object} criteria - (Optional) String or single-valued map converted to a where clause of the form "where key = 'value'"

 */
QuickBooks.prototype.findJournalCodes = function(criteria) {
    return module.query(this, 'journalCode', criteria)
}

/**
 * Finds all JournalEntrys in QuickBooks, optionally matching the specified criteria
 *
 * @param  {object} criteria - (Optional) String or single-valued map converted to a where clause of the form "where key = 'value'"

 */
QuickBooks.prototype.findJournalEntries = function(criteria) {
    return module.query(this, 'journalEntry', criteria)
}

/**
 * Finds all Payments in QuickBooks, optionally matching the specified criteria
 *
 * @param  {object} criteria - (Optional) String or single-valued map converted to a where clause of the form "where key = 'value'"

 */
QuickBooks.prototype.findPayments = function(criteria) {
    return module.query(this, 'payment', criteria)
}

/**
 * Finds all PaymentMethods in QuickBooks, optionally matching the specified criteria
 *
 * @param  {object} criteria - (Optional) String or single-valued map converted to a where clause of the form "where key = 'value'"

 */
QuickBooks.prototype.findPaymentMethods = function(criteria) {
    return module.query(this, 'paymentMethod', criteria)
}

/**
 * Finds all Preferencess in QuickBooks, optionally matching the specified criteria
 *
 * @param  {object} criteria - (Optional) String or single-valued map converted to a where clause of the form "where key = 'value'"

 */
QuickBooks.prototype.findPreferenceses = function(criteria) {
    return module.query(this, 'preferences', criteria)
}

/**
 * Finds all Purchases in QuickBooks, optionally matching the specified criteria
 *
 * @param  {object} criteria - (Optional) String or single-valued map converted to a where clause of the form "where key = 'value'"

 */
QuickBooks.prototype.findPurchases = function(criteria) {
    return module.query(this, 'purchase', criteria)
}

/**
 * Finds all PurchaseOrders in QuickBooks, optionally matching the specified criteria
 *
 * @param  {object} criteria - (Optional) String or single-valued map converted to a where clause of the form "where key = 'value'"

 */
QuickBooks.prototype.findPurchaseOrders = function(criteria) {
    return module.query(this, 'purchaseOrder', criteria)
}

/**
 * Finds all RefundReceipts in QuickBooks, optionally matching the specified criteria
 *
 * @param  {object} criteria - (Optional) String or single-valued map converted to a where clause of the form "where key = 'value'"

 */
QuickBooks.prototype.findRefundReceipts = function(criteria) {
    return module.query(this, 'refundReceipt', criteria)
}

/**
 * Finds all SalesReceipts in QuickBooks, optionally matching the specified criteria
 *
 * @param  {object} criteria - (Optional) String or single-valued map converted to a where clause of the form "where key = 'value'"

 */
QuickBooks.prototype.findSalesReceipts = function(criteria) {
    return module.query(this, 'salesReceipt', criteria)
}

/**
 * Finds all TaxAgencys in QuickBooks, optionally matching the specified criteria
 *
 * @param  {object} criteria - (Optional) String or single-valued map converted to a where clause of the form "where key = 'value'"

 */
QuickBooks.prototype.findTaxAgencies = function(criteria) {
    return module.query(this, 'taxAgency', criteria)
}

/**
 * Finds all TaxCodes in QuickBooks, optionally matching the specified criteria
 *
 * @param  {object} criteria - (Optional) String or single-valued map converted to a where clause of the form "where key = 'value'"

 */
QuickBooks.prototype.findTaxCodes = function(criteria) {
    return module.query(this, 'taxCode', criteria)
}

/**
 * Finds all TaxRates in QuickBooks, optionally matching the specified criteria
 *
 * @param  {object} criteria - (Optional) String or single-valued map converted to a where clause of the form "where key = 'value'"

 */
QuickBooks.prototype.findTaxRates = function(criteria) {
    return module.query(this, 'taxRate', criteria)
}

/**
 * Finds all Terms in QuickBooks, optionally matching the specified criteria
 *
 * @param  {object} criteria - (Optional) String or single-valued map converted to a where clause of the form "where key = 'value'"

 */
QuickBooks.prototype.findTerms = function(criteria) {
    return module.query(this, 'term', criteria)
}

/**
 * Finds all TimeActivitys in QuickBooks, optionally matching the specified criteria
 *
 * @param  {object} criteria - (Optional) String or single-valued map converted to a where clause of the form "where key = 'value'"

 */
QuickBooks.prototype.findTimeActivities = function(criteria) {
    return module.query(this, 'timeActivity', criteria)
}

/**
 * Finds all Transfers in QuickBooks, optionally matching the specified criteria
 *
 * @param  {object} criteria - (Optional) String or single-valued map converted to a where clause of the form "where key = 'value'"

 */
QuickBooks.prototype.findTransfers = function(criteria) {
    return module.query(this, 'transfer', criteria)
}

/**
 * Finds all Vendors in QuickBooks, optionally matching the specified criteria
 *
 * @param  {object} criteria - (Optional) String or single-valued map converted to a where clause of the form "where key = 'value'"

 */
QuickBooks.prototype.findVendors = function(criteria) {
    return module.query(this, 'vendor', criteria);
}

/**
 * Finds all VendorCredits in QuickBooks, optionally matching the specified criteria
 *
 * @param  {object} criteria - (Optional) String or single-valued map converted to a where clause of the form "where key = 'value'"

 */
QuickBooks.prototype.findVendorCredits = function(criteria) {
    return module.query(this, 'vendorCredit', criteria)
}

/**
 * Finds all ExchangeRates in QuickBooks, optionally matching the specified criteria
 *
 * @param  {object} criteria - (Optional) String or single-valued map converted to a where clause of the form "where key = 'value'"

 */
QuickBooks.prototype.findExchangeRates = function(criteria) {
    return module.query(this, 'exchangerate', criteria)
}


/**
 * Retrieves the BalanceSheet Report from QuickBooks
 *
 * @param  {object} options - (Optional) Map of key-value pairs passed as options to the Report

 */
QuickBooks.prototype.reportBalanceSheet = function(options) {
    return module.report(this, 'BalanceSheet', options)
}

/**
 * Retrieves the ProfitAndLoss Report from QuickBooks
 *
 * @param  {object} options - (Optional) Map of key-value pairs passed as options to the Report

 */
QuickBooks.prototype.reportProfitAndLoss = function(options) {
    return module.report(this, 'ProfitAndLoss', options)
}

/**
 * Retrieves the ProfitAndLossDetail Report from QuickBooks
 *
 * @param  {object} options - (Optional) Map of key-value pairs passed as options to the Report

 */
QuickBooks.prototype.reportProfitAndLossDetail = function(options) {
    return module.report(this, 'ProfitAndLossDetail', options)
}

/**
 * Retrieves the TrialBalance Report from QuickBooks
 *
 * @param  {object} options - (Optional) Map of key-value pairs passed as options to the Report

 */
QuickBooks.prototype.reportTrialBalance = function(options) {
    return module.report(this, 'TrialBalance', options)
}

/**
 * Retrieves the TrialBalanceFR Report from QuickBooks
 *
 * @param  {object} options - (Optional) Map of key-value pairs passed as options to the Report

 */
QuickBooks.prototype.reportTrialBalanceFR = function(options) {
    return module.report(this, 'TrialBalanceFR', options)
}

/**
 * Retrieves the CashFlow Report from QuickBooks
 *
 * @param  {object} options - (Optional) Map of key-value pairs passed as options to the Report

 */
QuickBooks.prototype.reportCashFlow = function(options) {
    return module.report(this, 'CashFlow', options)
}

/**
 * Retrieves the InventoryValuationSummary Report from QuickBooks
 *
 * @param  {object} options - (Optional) Map of key-value pairs passed as options to the Report

 */
QuickBooks.prototype.reportInventoryValuationSummary = function(options) {
    return module.report(this, 'InventoryValuationSummary', options)
}

/**
 * Retrieves the CustomerSales Report from QuickBooks
 *
 * @param  {object} options - (Optional) Map of key-value pairs passed as options to the Report

 */
QuickBooks.prototype.reportCustomerSales = function(options) {
    return module.report(this, 'CustomerSales', options)
}

/**
 * Retrieves the ItemSales Report from QuickBooks
 *
 * @param  {object} options - (Optional) Map of key-value pairs passed as options to the Report

 */
QuickBooks.prototype.reportItemSales = function(options) {
    return module.report(this, 'ItemSales', options)
}

/**
 * Retrieves the CustomerIncome Report from QuickBooks
 *
 * @param  {object} options - (Optional) Map of key-value pairs passed as options to the Report

 */
QuickBooks.prototype.reportCustomerIncome = function(options) {
    return module.report(this, 'CustomerIncome', options)
}

/**
 * Retrieves the CustomerBalance Report from QuickBooks
 *
 * @param  {object} options - (Optional) Map of key-value pairs passed as options to the Report

 */
QuickBooks.prototype.reportCustomerBalance = function(options) {
    return module.report(this, 'CustomerBalance', options)
}

/**
 * Retrieves the CustomerBalanceDetail Report from QuickBooks
 *
 * @param  {object} options - (Optional) Map of key-value pairs passed as options to the Report

 */
QuickBooks.prototype.reportCustomerBalanceDetail = function(options) {
    return module.report(this, 'CustomerBalanceDetail', options)
}

/**
 * Retrieves the AgedReceivables Report from QuickBooks
 *
 * @param  {object} options - (Optional) Map of key-value pairs passed as options to the Report

 */
QuickBooks.prototype.reportAgedReceivables = function(options) {
    return module.report(this, 'AgedReceivables', options)
}

/**
 * Retrieves the AgedReceivableDetail Report from QuickBooks
 *
 * @param  {object} options - (Optional) Map of key-value pairs passed as options to the Report

 */
QuickBooks.prototype.reportAgedReceivableDetail = function(options) {
    return module.report(this, 'AgedReceivableDetail', options)
}

/**
 * Retrieves the VendorBalance Report from QuickBooks
 *
 * @param  {object} options - (Optional) Map of key-value pairs passed as options to the Report

 */
QuickBooks.prototype.reportVendorBalance = function(options) {
    return module.report(this, 'VendorBalance', options)
}

/**
 * Retrieves the VendorBalanceDetail Report from QuickBooks
 *
 * @param  {object} options - (Optional) Map of key-value pairs passed as options to the Report

 */
QuickBooks.prototype.reportVendorBalanceDetail = function(options) {
    return module.report(this, 'VendorBalanceDetail', options)
}

/**
 * Retrieves the AgedPayables Report from QuickBooks
 *
 * @param  {object} options - (Optional) Map of key-value pairs passed as options to the Report

 */
QuickBooks.prototype.reportAgedPayables = function(options) {
    return module.report(this, 'AgedPayables', options)
}

/**
 * Retrieves the AgedPayableDetail Report from QuickBooks
 *
 * @param  {object} options - (Optional) Map of key-value pairs passed as options to the Report

 */
QuickBooks.prototype.reportAgedPayableDetail = function(options) {
    return module.report(this, 'AgedPayableDetail', options)
}

/**
 * Retrieves the VendorExpenses Report from QuickBooks
 *
 * @param  {object} options - (Optional) Map of key-value pairs passed as options to the Report

 */
QuickBooks.prototype.reportVendorExpenses = function(options) {
    return module.report(this, 'VendorExpenses', options)
}

/**
 * Retrieves the TransactionList Report from QuickBooks
 *
 * @param  {object} options - (Optional) Map of key-value pairs passed as options to the Report

 */
QuickBooks.prototype.reportTransactionList = function(options) {
    return module.report(this, 'TransactionList', options)
}

/**
 * Retrieves the GeneralLedgerDetail Report from QuickBooks
 *
 * @param  {object} options - (Optional) Map of key-value pairs passed as options to the Report

 */
QuickBooks.prototype.reportGeneralLedgerDetail = function(options) {
    return module.report(this, 'GeneralLedger', options)
}

/**
 * Retrieves the TaxSummary Report from QuickBooks
 *
 * @param  {object} options - (Optional) Map of key-value pairs passed as options to the Report

 */
QuickBooks.prototype.reportTaxSummary = function(options) {
    return module.report(this, 'TaxSummary', options)
}

/**
 * Retrieves the DepartmentSales Report from QuickBooks
 *
 * @param  {object} options - (Optional) Map of key-value pairs passed as options to the Report

 */
QuickBooks.prototype.reportDepartmentSales = function(options) {
    return module.report(this, 'DepartmentSales', options)
}

/**
 * Retrieves the ClassSales Report from QuickBooks
 *
 * @param  {object} options - (Optional) Map of key-value pairs passed as options to the Report

 */
QuickBooks.prototype.reportClassSales = function(options) {
    return module.report(this, 'ClassSales', options)
}

/**
 * Retrieves the AccountListDetail Report from QuickBooks
 *
 * @param  {object} options - (Optional) Map of key-value pairs passed as options to the Report

 */
QuickBooks.prototype.reportAccountListDetail = function(options) {
    return module.report(this, 'AccountList', options)
}

/**
 * Retrieves the JournalReport Report from QuickBooks
 *
 * @param  {object} options - (Optional) Map of key-value pairs passed as options to the Report

 */
QuickBooks.prototype.reportJournalReport = function(options) {
    return module.report(this, 'JournalReport', options)
}

const defaultQueryResponseProps = [
    "maxResults",
    "startPosition",
    "totalCount"
];

const defaultGetResponseProps = [
    "time"
];

module.request = function(context, verb, options, entity) {
    var url = context.endpoint + context.realmId + options.url
    if (options.url === QuickBooks.RECONNECT_URL || options.url == QuickBooks.DISCONNECT_URL || options.url === QuickBooks.REVOKE_URL || options.url === QuickBooks.USER_INFO_URL) {
        url = options.url
    }
    var opts = {
        url:     url,
        qs:      options.qs || {},
        headers: options.headers || {},
        json:    true
    }

    if (entity && entity.allowDuplicateDocNum) {
        delete entity.allowDuplicateDocNum;
        opts.qs.include = 'allowduplicatedocnum';
    }

    if (entity && entity.requestId) {
        opts.qs.requestid = entity.requestId;
        delete entity.requestId;
    }

    opts.qs.minorversion = opts.qs.minorversion || context.minorversion;
    opts.headers['User-Agent'] = 'node-quickbooks: version ' + version
    opts.headers['Request-Id'] = uuid()
    opts.qs.format = 'json';
    opts.headers['Authorization'] =  'Bearer ' + context.token
    if (options.url.match(/pdf$/)) {
        opts.headers['accept'] = 'application/pdf'
        opts.encoding = null
    }
    if (entity !== null) {
        opts.body = entity
    }
    if (options.formData) {
        opts.formData = options.formData
    }
    if ('production' !== process.env.NODE_ENV && context.debug) {
        debug(request)
    }
    return new Promise((resolve, reject) => {
        request[verb].call(context, opts, function (err, res, body) {
            if ('production' !== process.env.NODE_ENV && context.debug) {
                console.log('invoking endpoint: ' + url)
                console.log(entity || '')
                console.log(JSON.stringify(body, null, 2));
            }
            if (
                err
                || res.statusCode >= 300
                || (_.isObject(body) && body.Fault && body.Fault.Error && body.Fault.Error.length)
                || (_.isString(body) && !_.isEmpty(body) && body.indexOf('<') === 0)
            ) {
                reject(err || body);
            } else {
                let seenData = false;
                const newObj = {};
                const isQuery = body.QueryResponse !== undefined;
                if (!isQuery) {
                    let keyToDelete = null;
                    for (const key in body) {
                        if (body[key]  === undefined) {
                            continue;
                        }
                        if (defaultGetResponseProps.includes(key)) {
                            newObj[key] = body[key];
                        } else if (seenData) {
                            throw new Error(`Unexpected property ${key} in QueryResponse`);
                        } else {
                            keyToDelete = key;
                            newObj.data = body[key];
                            seenData = true;
                        }
                    }
                    if (!seenData) {
                        throw new Error(`Unexpected empty data`);
                    }
                    delete body[keyToDelete];
                    resolve({ ...body, ...newObj });
                } else {
                    for (const key in body.QueryResponse) {
                        if (body.QueryResponse[key] === undefined) {
                            continue;
                        }
                        if (defaultQueryResponseProps.includes(key)) {
                            newObj[key] = body.QueryResponse[key];
                        } else if (seenData) {
                            throw new Error(`Unexpected property ${key} in QueryResponse`);
                        } else {
                            newObj.data = body.QueryResponse[key];
                            seenData = true;
                        }
                    }
                    if (!seenData) {
                        throw new Error(`Unexpected empty QueryResponse`);
                    }
                    delete body.QueryResponse;
                    resolve({ ...body, ...newObj });
                }
            }
        })
    })
}

module.requestOrig = function(context, verb, options, entity, callback) {
    var url = context.endpoint + context.realmId + options.url
    if (options.url === QuickBooks.RECONNECT_URL || options.url == QuickBooks.DISCONNECT_URL || options.url === QuickBooks.REVOKE_URL || options.url === QuickBooks.USER_INFO_URL) {
        url = options.url
    }
    var opts = {
        url:     url,
        qs:      options.qs || {},
        headers: options.headers || {},
        json:    true
    }

    if (entity && entity.allowDuplicateDocNum) {
        delete entity.allowDuplicateDocNum;
        opts.qs.include = 'allowduplicatedocnum';
    }

    if (entity && entity.requestId) {
        opts.qs.requestid = entity.requestId;
        delete entity.requestId;
    }

    opts.qs.minorversion = opts.qs.minorversion || context.minorversion;
    opts.headers['User-Agent'] = 'node-quickbooks: version ' + version
    opts.headers['Request-Id'] = uuid()
    opts.qs.format = 'json';
    opts.headers['Authorization'] =  'Bearer ' + context.token
    if (options.url.match(/pdf$/)) {
        opts.headers['accept'] = 'application/pdf'
        opts.encoding = null
    }
    if (entity !== null) {
        opts.body = entity
    }
    if (options.formData) {
        opts.formData = options.formData
    }
    if ('production' !== process.env.NODE_ENV && context.debug) {
        debug(request)
    }
    request[verb].call(context, opts, function (err, res, body) {
        if ('production' !== process.env.NODE_ENV && context.debug) {
            console.log('invoking endpoint: ' + url)
            console.log(entity || '')
            console.log(JSON.stringify(body, null, 2));
        }
        if (callback) {
            if (err ||
                res.statusCode >= 300 ||
                (_.isObject(body) && body.Fault && body.Fault.Error && body.Fault.Error.length) ||
                (_.isString(body) && !_.isEmpty(body) && body.indexOf('<') === 0)) {
                callback(err || body, body, res)
            } else {
                callback(null, body, res)
            }
        }
    })
}

module.xmlRequest = function(context, url, rootTag) {
    return new Promise((resolve, reject) => {
        module.requestOrig(context, 'get', {url:url}, null, (err, body) => {
            var json =
                body.constructor === {}.constructor ? body :
                    (body.constructor === "".constructor ?
                        (body.indexOf('<') === 0 ? jxon.stringToJs(body)[rootTag] : body) : body);
            if (json.ErrorCode !== 0) {
                reject(json);
            } else {
                reject(json);
            }
        })
    });
}



QuickBooks.prototype.reconnect = function() {
    return module.xmlRequest(this, QuickBooks.RECONNECT_URL, 'ReconnectResponse');
}

QuickBooks.prototype.disconnect = function() {
    return module.xmlRequest(this, QuickBooks.DISCONNECT_URL, 'PlatformResponse');
}

// **********************  CRUD Api **********************
module.create = function(context, entityName, entity) {
    var url = '/' + entityName.toLowerCase()
    return module.request(context, 'post', {url: url}, entity)
}

module.read = function(context, entityName, id) {
    var url = '/' + entityName.toLowerCase()
    if (id) url = url + '/' + id
    return module.request(context, 'get', {url: url}, null)
}

module.update = function(context, entityName, entity) {
    if (_.isUndefined(entity.Id) ||
        _.isEmpty(entity.Id + '') ||
        _.isUndefined(entity.SyncToken) ||
        _.isEmpty(entity.SyncToken + '')) {
        if (entityName !== 'exchangerate') {
            throw new Error(entityName + ' must contain Id and SyncToken fields: ' +
                util.inspect(entity, {showHidden: false, depth: null}))
        }
    }
    if (! entity.hasOwnProperty('sparse')) {
        entity.sparse = true
    }
    var url = '/' + entityName.toLowerCase() + '?operation=update'
    var opts = {url: url}
    if (entity.void && entity.void.toString() === 'true') {
        opts.qs = { include: 'void' }
        delete entity.void
    }
    return module.request(context, 'post', opts, entity)
}

module.delete = function(context, entityName, idOrEntity) {
    var url = '/' + entityName.toLowerCase() + '?operation=delete'
    if (_.isObject(idOrEntity)) {
        return module.request(context, 'post', {url: url}, idOrEntity)
    } else {
        return new Promise((resolve, reject) => {
            module.read(context, entityName, idOrEntity, function(err, entity) {
                if (err) {
                    reject(err)
                } else {
                    resolve(module.request(context, 'post', {url: url}, entity))
                }
            })
        });
    }
}

module.void = function (context, entityName, idOrEntity) {
    var url = '/' + entityName.toLowerCase() + '?operation=void'
    if (_.isObject(idOrEntity)) {
        return module.request(context, 'post', { url: url }, idOrEntity)
    } else {
        return new Promise((resolve, reject) => {
            module.read(context, entityName, idOrEntity, function (err, entity) {
                if (err) {
                    reject(err)
                } else {
                    resolve(module.request(context, 'post', { url: url }, entity))
                }
            })
        });
    }
}

// **********************  Query Api **********************
module.requestPromise = Promise.promisify(module.request)


module.query = function(context, entity, criteria) {

    // criteria is potentially mutated within this function -
    // so make a copy of it first
    if (! _.isFunction(criteria) && (_.isObject(criteria) || _.isArray(criteria))) {
        criteria = JSON.parse(JSON.stringify(criteria));
    }

    var url = '/query?query@@select * from ' + entity
    var count = function(obj) {
        for (var p in obj) {
            if (obj[p] && p.toLowerCase() === 'count') {
                url = url.replace('select \* from', 'select count(*) from')
                delete obj[p]
            }
        }
    }
    count(criteria)
    if (_.isArray(criteria)) {
        for (var i = 0; i < criteria.length; i++) {
            if (_.isObject(criteria[i])) {
                var j = Object.keys(criteria[i]).length
                count(criteria[i])
                if (j !== Object.keys(criteria[i]).length) {
                    criteria.splice(i, i + 1)
                }
            }
        }
    }

    var fetchAll = false, limit = 1000, offset = 1
    if (_.isArray(criteria)) {
        var lmt = _.find(criteria, function(obj) {
            return obj.field && obj.field === 'limit'
        })
        if (lmt) limit = lmt.value
        var ofs = _.find(criteria, function(obj) {
            return obj.field && obj.field === 'offset'
        })
        if (! ofs) {
            criteria.push({field: 'offset', value: 1})
        } else {
            offset = ofs.value
        }
        var fa = _.find(criteria, function(obj) {
            return obj.field && obj.field === 'fetchAll'
        })
        if (fa && fa.value) fetchAll = true
    } else if (_.isObject(criteria)) {
        limit = criteria.limit = criteria.limit || 1000
        offset = criteria.offset = criteria.offset || 1
        if (criteria.fetchAll) fetchAll = true
    }

    if (criteria && !_.isFunction(criteria)) {
        url += module.criteriaToString(criteria) || ''
        url = url.replace(/%/g, '%25')
            .replace(/'/g, '%27')
            .replace(/=/g, '%3D')
            .replace(/</g, '%3C')
            .replace(/>/g, '%3E')
            .replace(/&/g, '%26')
            .replace(/#/g, '%23')
            .replace(/\\/g, '%5C')
            .replace(/\+/g, '%2B')
    }
    url = url.replace('@@', '=')

    return new Promise(function(resolve, reject) {
        module.request(context, 'get', {url: url}, null).then(function(resBody) {
            // var fields = Object.keys(data.QueryResponse)
            // var key = _.find(fields, function(k) { return k.toLowerCase() === entity.toLowerCase()})
            if (fetchAll) {
                if (resBody && resBody.data && resBody.maxResults === limit) {
                    if (_.isArray(criteria)) {
                        _.each(criteria, function(e) {
                            if (e.field === 'offset') e.value = e.value + limit
                        })
                    } else if (_.isObject(criteria)) {
                        criteria.offset = criteria.offset + limit
                    }
                    return module.query(context, entity, criteria).then(function(more) {
                        resBody.data = resBody.data.concat(more.data || [])
                        resBody.maxResults = resBody.maxResults + (more.maxResults || 0)
                        resBody.time = more.time || resBody.time
                        resolve(resBody)
                    })
                } else {
                    // const queryResponse = { ...data.QueryResponse };
                    // delete data.QueryResponse;
                    resolve(resBody);
                }
            } else {
                // const queryResponse = { ...resBody.QueryResponse };
                // delete resBody.QueryResponse;
                resolve(resBody);
            }
        }).catch(function(err) {
            reject(err)
        })
    })
}


// **********************  Report Api **********************
module.report = function(context, reportType, criteria) {
    var url = '/reports/' + reportType
    if (typeof criteria === 'function') {
        throw new Error('Criteria must not be a function')
    }
    if (criteria && typeof criteria !== 'function') {
        url += module.reportCriteria(criteria) || ''
    }
    return module.request(context, 'get', {url: url}, null)
}


module.oauth = function(context) {
    return {
        consumer_key:    context.consumerKey,
        consumer_secret: context.consumerSecret,
        token:           context.token,
        token_secret:    context.tokenSecret
    }
}

module.isNumeric = function(n) {
    return ! isNaN(parseFloat(n)) && isFinite(n);
}

module.checkProperty = function(field, name) {
    return (field && field.toLowerCase() === name)
}

module.toCriterion = function(c) {
    var fields = _.keys(c)
    if (_.intersection(fields, ['field', 'value']).length === 2) {
        return {
            field: c.field,
            value: c.value,
            operator: c.operator || '='
        }
    } else {
        return fields.map(function(k) {
            return {
                field: k,
                value: c[k],
                operator: _.isArray(c[k]) ? 'IN' : '='
            }
        })
    }
}

module.criteriaToString = function(criteria) {
    if (_.isString(criteria)) return criteria.indexOf(' ') === 0 ? criteria : " " + criteria
    var cs = _.isArray(criteria) ? criteria.map(module.toCriterion) : module.toCriterion(criteria)
    var flattened = _.flatten(cs)
    var sql = '', limit, offset, desc, asc
    for (var i=0, l=flattened.length; i<l; i++) {
        var criterion = flattened[i];
        if (module.checkProperty(criterion.field, 'fetchall')) {
            continue
        }
        if (module.checkProperty(criterion.field, 'limit')) {
            limit = criterion.value
            continue
        }
        if (module.checkProperty(criterion.field, 'offset')) {
            offset = criterion.value
            continue
        }
        if (module.checkProperty(criterion.field, 'desc')) {
            desc = criterion.value
            continue
        }
        if (module.checkProperty(criterion.field, 'asc')) {
            asc = criterion.value
            continue
        }
        if (sql != '') {
            sql += ' and '
        }
        sql += criterion.field + ' ' + criterion.operator + ' '
        var quote = function(x) {
            return _.isString(x) ? "'" + x.replace(/'/g, "\\'") + "'" : x
        }
        if (_.isArray(criterion.value)) {
            sql += '(' + criterion.value.map(quote).join(',') + ')'
        } else {
            sql += quote(criterion.value)
        }
    }
    if (sql != '') {
        sql = ' where ' + sql
    }
    if (asc)  sql += ' orderby ' + asc + ' asc'
    if (desc) sql += ' orderby ' + desc + ' desc'
    sql += ' startposition ' + (offset || 1)
    sql += ' maxresults ' + (limit || 1000)
    return sql
}

module.reportCriteria = function(criteria) {
    let s = '?'
    for (let p in criteria) {
        s += p + '=' + criteria[p] + '&'
    }
    return s
}

module.capitalize = function(s) {
    return s.substring(0, 1).toUpperCase() + s.substring(1)
}

QuickBooks.prototype.capitalize = module.capitalize

module.pluralize = function(s) {
    let last = s.substring(s.length - 1)
    if (last === 's') {
        return s + "es"
    } else if (last === 'y') {
        return s.substring(0, s.length - 1) + "ies"
    } else {
        return s + 's'
    }
}

QuickBooks.prototype.pluralize = module.pluralize

module.unwrap = function(callback, entityName) {
    if (! callback) return function(err, data, res) {}
    return new Promise((resolve, reject) => {

    });
    return function(err, data, res) {
        if (err) {
            if (callback) {
                callback(err, null, res)
            }
        } else {
            const name = module.capitalize(entityName)
            if (callback) {
                callback(err, (data || {})[name] || data, res)
            }
        }
    }
}
