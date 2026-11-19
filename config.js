// SwingMirror – forbindelsesopsætning.
// Tom konfiguration = PeerJS' gratis offentlige signaleringsserver og delte TURN-servere (fint til test).
// Før udgivelse bør du bruge din egen server – se README.md, afsnittet "Stabil forbindelse".
window.SWINGMIRROR_CONFIG = {
  // Egen PeerJS-server (signalering). Fjern kommentarerne og udfyld:
  peer: {
    // host: 'peer.dit-domaene.dk',
    // port: 443,
    // path: '/',
    // secure: true,
  },

  // Egne ICE-servere. Hvis listen er tom, bruger PeerJS sine standardservere.
  // Medtag både STUN og TURN, når du udfylder den:
  iceServers: [
    // { urls: 'stun:stun.l.google.com:19302' },
    // { urls: 'turn:turn.dit-domaene.dk:3478', username: 'bruger', credential: 'kodeord' },
  ],
};
