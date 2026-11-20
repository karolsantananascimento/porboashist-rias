// Catálogo das chaves de API que o assinante cola no sistema, com o passo a passo de cada uma (botão "?" na tela).
// Só as chaves listadas aqui podem ser gravadas por um assinante.

const META_AVISO = 'Os menus da Meta mudam com frequência. Se algum nome estiver diferente, procure pelo equivalente.';
const GOOGLE_AVISO = 'O Google muda os menus de tempos em tempos. Se algum nome estiver diferente, procure pelo equivalente.';

const GRUPOS = [
  {
    id: 'meta',
    titulo: 'Meta Ads (Facebook e Instagram)',
    intro: 'Para criar e acompanhar campanhas no Facebook e no Instagram.',
    campos: [
      {
        chave: 'META_ADS_TOKEN', rotulo: 'Token de acesso', obrigatorio: true,
        ajuda: {
          titulo: 'Como gerar o token de acesso da Meta',
          passos: [
            'Acesse developers.facebook.com/apps e crie um app (ou use um que você já tenha). Escolha o caso de uso de anúncios (API de Marketing).',
            'No painel do app, adicione o produto "API de Marketing".',
            'Abra business.facebook.com/settings → Usuários → Usuários do sistema → Adicionar. Dê a função de Administrador.',
            'Em "Adicionar ativos", libere para esse usuário a sua Conta de anúncios (controle total) e a sua Página do Facebook.',
            'Clique em "Gerar novo token", escolha o seu app e marque as permissões ads_management, ads_read e business_management.',
            'Copie o token e cole aqui. Ele só aparece uma vez; um token de usuário do sistema não expira.',
          ],
          links: [['Meus apps na Meta', 'https://developers.facebook.com/apps'], ['Usuários do sistema', 'https://business.facebook.com/settings/system-users']],
          nota: META_AVISO,
        },
      },
      {
        chave: 'META_AD_ACCOUNT_ID', rotulo: 'ID da conta de anúncios', obrigatorio: true, exemplo: 'act_1234567890',
        ajuda: {
          titulo: 'Onde achar o ID da conta de anúncios',
          passos: [
            'Abra o Gerenciador de Anúncios (adsmanager.facebook.com).',
            'No topo, no seletor de conta, o número que aparece ao lado do nome da conta é o ID. Ele também aparece na barra de endereço, depois de "act=".',
            'Pode colar só os números ou com o "act_" na frente.',
          ],
          links: [['Gerenciador de Anúncios', 'https://adsmanager.facebook.com']],
        },
      },
      {
        chave: 'META_PAGE_ID', rotulo: 'ID da página do Facebook', obrigatorio: true, exemplo: '102938475610293',
        ajuda: {
          titulo: 'Onde achar o ID da página',
          passos: [
            'Abra a sua Página do Facebook.',
            'Vá em "Sobre" (ou "Transparência da página") e role até "ID da Página".',
            'Outra forma: business.facebook.com/settings → Contas → Páginas; o ID aparece ao selecionar a página.',
          ],
          links: [['Páginas no Business Manager', 'https://business.facebook.com/settings/pages']],
        },
      },
      {
        chave: 'META_IG_ID', rotulo: 'ID do Instagram profissional (opcional)', obrigatorio: false, exemplo: '17841400000000000',
        ajuda: {
          titulo: 'Para anunciar também com a identidade do Instagram',
          passos: [
            'A conta do Instagram precisa ser profissional e estar vinculada à sua Página.',
            'Em business.facebook.com/settings → Contas → Contas do Instagram, selecione a conta e copie o ID.',
            'Sem este campo os anúncios rodam em nome da Página; mensagens no Instagram Direct exigem a conta vinculada.',
          ],
          links: [['Contas do Instagram', 'https://business.facebook.com/settings/instagram-account']],
        },
      },
      {
        chave: 'META_PIXEL_ID', rotulo: 'ID do pixel (opcional)', obrigatorio: false, exemplo: '123456789012345',
        ajuda: {
          titulo: 'Para campanhas de Leads ou Vendas no seu site',
          passos: [
            'Abra o Gerenciador de Eventos (business.facebook.com/events_manager).',
            'Em "Fontes de dados", selecione o seu pixel; o ID aparece abaixo do nome.',
            'Sem pixel você ainda pode usar os objetivos Tráfego, Reconhecimento e Engajamento, e Leads por WhatsApp.',
          ],
          links: [['Gerenciador de Eventos', 'https://business.facebook.com/events_manager']],
        },
      },
      {
        chave: 'META_MAX_DAILY_BUDGET_BRL', rotulo: 'Teto de orçamento diário por campanha, em R$ (opcional)', obrigatorio: false, exemplo: '100',
        ajuda: {
          titulo: 'Trava de segurança',
          passos: [
            'O sistema recusa criar uma campanha com orçamento diário acima deste valor. Se ficar em branco, o teto é R$ 100.',
            'Aumente só quando tiver certeza do quanto quer gastar por dia em cada campanha.',
          ],
        },
      },
    ],
  },
  {
    id: 'googleads',
    titulo: 'Google Ads',
    intro: 'Para criar campanhas de Pesquisa e acompanhar o desempenho no Google.',
    campos: [
      {
        chave: 'GOOGLE_ADS_DEVELOPER_TOKEN', rotulo: 'Developer token', obrigatorio: true,
        ajuda: {
          titulo: 'Como conseguir o developer token',
          passos: [
            'Entre no Google Ads com uma conta gerenciadora (MCC). Se não tiver, crie uma em ads.google.com/home/tools/manager-accounts (é gratuita) e vincule a sua conta de anúncios a ela.',
            'Na conta gerenciadora, abra Ferramentas → Configuração → Central de API.',
            'Preencha o formulário e solicite o token. Para mexer em contas reais é preciso o acesso "Básico", e a aprovação pode levar alguns dias.',
            'Copie o developer token e cole aqui.',
          ],
          links: [['Central de API', 'https://ads.google.com/aw/apicenter'], ['Criar conta gerenciadora', 'https://ads.google.com/home/tools/manager-accounts/']],
          nota: GOOGLE_AVISO,
        },
      },
      {
        chave: 'GOOGLE_ADS_CLIENT_ID', rotulo: 'Client ID (OAuth)', obrigatorio: true,
        ajuda: {
          titulo: 'Como criar o Client ID e o Client secret',
          passos: [
            'Acesse console.cloud.google.com e crie um projeto (ou escolha um).',
            'Em "APIs e serviços" → "Biblioteca", procure por "Google Ads API" e ative.',
            'Em "APIs e serviços" → "Tela de consentimento OAuth", configure o app (tipo Externo) e publique-o em produção. Em modo de teste o refresh token expira em 7 dias.',
            'Em "Credenciais" → "Criar credenciais" → "ID do cliente OAuth", escolha "Aplicativo da Web".',
            'Em "URIs de redirecionamento autorizados", adicione https://developers.google.com/oauthplayground',
            'Copie o ID do cliente aqui e a chave secreta no campo seguinte.',
          ],
          links: [['Google Cloud Console', 'https://console.cloud.google.com/apis/credentials']],
          nota: GOOGLE_AVISO,
        },
      },
      {
        chave: 'GOOGLE_ADS_CLIENT_SECRET', rotulo: 'Client secret (OAuth)', obrigatorio: true,
        ajuda: {
          titulo: 'Client secret',
          passos: ['É a "Chave secreta do cliente" criada junto com o Client ID, na mesma tela de Credenciais do Google Cloud. Veja o passo a passo do Client ID.'],
          links: [['Google Cloud Console', 'https://console.cloud.google.com/apis/credentials']],
        },
      },
      {
        chave: 'GOOGLE_ADS_REFRESH_TOKEN', rotulo: 'Refresh token', obrigatorio: true,
        ajuda: {
          titulo: 'Como gerar o refresh token',
          passos: [
            'Abra developers.google.com/oauthplayground.',
            'Clique na engrenagem (canto superior direito), marque "Use your own OAuth credentials" e cole o Client ID e o Client secret.',
            'Na caixa "Input your own scopes", digite https://www.googleapis.com/auth/adwords e clique em "Authorize APIs".',
            'Entre com a conta Google que tem acesso ao Google Ads e aceite.',
            'Clique em "Exchange authorization code for tokens" e copie o "Refresh token".',
          ],
          links: [['OAuth Playground', 'https://developers.google.com/oauthplayground']],
          nota: 'Guarde o refresh token como uma senha. Se o app do Google Cloud estiver em modo de teste, ele expira em 7 dias.',
        },
      },
      {
        chave: 'GOOGLE_ADS_CUSTOMER_ID', rotulo: 'ID da conta de anúncios (10 dígitos)', obrigatorio: true, exemplo: '123-456-7890',
        ajuda: {
          titulo: 'Onde achar o ID da conta do Google Ads',
          passos: ['Entre no Google Ads. O ID de 10 dígitos (123-456-7890) aparece no canto superior direito, abaixo do nome da conta.', 'Pode colar com ou sem os traços.'],
          links: [['Google Ads', 'https://ads.google.com']],
        },
      },
      {
        chave: 'GOOGLE_ADS_LOGIN_CUSTOMER_ID', rotulo: 'ID da conta gerenciadora/MCC (opcional)', obrigatorio: false, exemplo: '987-654-3210',
        ajuda: {
          titulo: 'Quando preencher',
          passos: ['Se você acessa a conta de anúncios por uma conta gerenciadora (MCC), cole aqui o ID de 10 dígitos da MCC. Se acessa a conta diretamente, deixe em branco.'],
        },
      },
      {
        chave: 'GOOGLE_ADS_MAX_DAILY_BUDGET_BRL', rotulo: 'Teto de orçamento diário por campanha, em R$ (opcional)', obrigatorio: false, exemplo: '100',
        ajuda: { titulo: 'Trava de segurança', passos: ['O sistema recusa criar ou aumentar uma campanha acima deste valor por dia. Se ficar em branco, o teto é R$ 100.'] },
      },
    ],
  },
];

const PERMITIDAS = new Set(GRUPOS.flatMap((g) => g.campos.map((c) => c.chave)));

// Normaliza e valida o valor colado. Devolve o valor limpo ou lança erro com mensagem clara.
function normalizarValor(chave, bruto) {
  let v = String(bruto ?? '').trim();
  const falha = (m) => { throw Object.assign(new Error(m), { status: 400 }); };
  if (!v) falha('Cole o valor da chave.');
  if (/\s/.test(v) && !/^GOOGLE_ADS_(CUSTOMER|LOGIN)/.test(chave)) falha('O valor não pode ter espaços ou quebras de linha. Copie de novo, sem sobras.');
  switch (chave) {
    case 'META_AD_ACCOUNT_ID': {
      v = v.replace(/^act_/i, '');
      if (!/^\d{5,20}$/.test(v)) falha('O ID da conta de anúncios tem só números (ex.: act_1234567890).');
      return `act_${v}`;
    }
    case 'META_PAGE_ID': case 'META_IG_ID': case 'META_PIXEL_ID':
      if (!/^\d{5,25}$/.test(v)) falha('Este ID tem só números.');
      return v;
    case 'GOOGLE_ADS_CUSTOMER_ID': case 'GOOGLE_ADS_LOGIN_CUSTOMER_ID':
      v = v.replace(/[\s-]/g, '');
      if (!/^\d{10}$/.test(v)) falha('O ID do Google Ads tem 10 dígitos (ex.: 123-456-7890).');
      return v;
    case 'META_MAX_DAILY_BUDGET_BRL': case 'GOOGLE_ADS_MAX_DAILY_BUDGET_BRL': {
      const n = Number(v.replace(',', '.'));
      if (!(n > 0) || n > 100000) falha('Informe um valor em reais maior que zero.');
      return String(n);
    }
    case 'META_ADS_TOKEN': if (v.length < 20) falha('Este token parece curto demais. Copie o token inteiro.'); return v;
    case 'GOOGLE_ADS_REFRESH_TOKEN': if (v.length < 20) falha('Este token parece curto demais. Copie o token inteiro.'); return v;
    case 'GOOGLE_ADS_CLIENT_ID': if (!/\.apps\.googleusercontent\.com$/.test(v)) falha('O Client ID termina com .apps.googleusercontent.com.'); return v;
    default: return v;
  }
}

module.exports = { GRUPOS, PERMITIDAS, normalizarValor };
