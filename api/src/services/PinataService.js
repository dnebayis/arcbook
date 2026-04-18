const config = require('../config');

const PINATA_API = 'https://api.pinata.cloud';

class PinataService {
  static isConfigured() {
    return Boolean(config.pinata?.jwt);
  }

  static authHeaders() {
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.pinata.jwt}`
    };
  }

  static async pinJSON(agentName, json) {
    const res = await fetch(`${PINATA_API}/pinning/pinJSONToIPFS`, {
      method: 'POST',
      headers: this.authHeaders(),
      body: JSON.stringify({
        pinataContent: json,
        pinataMetadata: { name: `arcbook-agent-${agentName}` }
      })
    });
    if (!res.ok) throw new Error(`Pinata pin failed: ${res.status} ${await res.text()}`);
    const data = await res.json();
    return data.IpfsHash; // CID
  }

  // Creates an IPNS key or returns the existing one (idempotent by name)
  static async ensureIpnsKey(agentName) {
    const keyName = `arcbook-${agentName}`;

    // List existing keys to check if one already exists
    const listRes = await fetch(`${PINATA_API}/v3/ipns/keys`, {
      headers: this.authHeaders()
    });
    if (listRes.ok) {
      const listData = await listRes.json();
      const existing = (listData.data?.items || []).find((k) => k.name === keyName);
      if (existing) return existing; // { id, name, ipnsName }
    }

    // Create new key
    const createRes = await fetch(`${PINATA_API}/v3/ipns/keys`, {
      method: 'POST',
      headers: this.authHeaders(),
      body: JSON.stringify({ name: keyName })
    });
    if (!createRes.ok) throw new Error(`Pinata IPNS key create failed: ${createRes.status} ${await createRes.text()}`);
    const createData = await createRes.json();
    return createData.data; // { id, name, ipnsName }
  }

  // Points an IPNS key to a new CID (zero-gas metadata update)
  static async publishToIpns(keyId, cid) {
    const res = await fetch(`${PINATA_API}/v3/ipns/${keyId}`, {
      method: 'PUT',
      headers: this.authHeaders(),
      body: JSON.stringify({ cid })
    });
    if (!res.ok) throw new Error(`Pinata IPNS publish failed: ${res.status} ${await res.text()}`);
    return (await res.json()).data; // { id, name, ipnsName, cid }
  }

  // Pin a file (base64) to IPFS → returns CID
  static async pinFile(filename, base64Data, mimeType) {
    const buffer = Buffer.from(base64Data, 'base64');
    const formData = new FormData();
    const blob = new Blob([buffer], { type: mimeType });
    formData.append('file', blob, filename);
    formData.append('pinataMetadata', JSON.stringify({ name: filename }));

    const res = await fetch(`${PINATA_API}/pinning/pinFileToIPFS`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.pinata.jwt}` },
      body: formData
    });
    if (!res.ok) throw new Error(`Pinata file pin failed: ${res.status} ${await res.text()}`);
    const data = await res.json();
    return data.IpfsHash; // CID
  }

  static gatewayUrl(cid) {
    return `https://gateway.pinata.cloud/ipfs/${cid}`;
  }

  // Full flow: pin JSON + ensure IPNS key + publish → returns { cid, ipnsKeyId, ipnsName, metadataUri }
  static async pinAndPublish(agentName, json) {
    const cid = await this.pinJSON(agentName, json);
    const key = await this.ensureIpnsKey(agentName);
    await this.publishToIpns(key.id, cid);
    return {
      cid,
      ipnsKeyId: key.id,
      ipnsName: key.ipnsName,
      metadataUri: `ipns://${key.ipnsName}`
    };
  }
}

module.exports = PinataService;
