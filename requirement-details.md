Aapko abhi current codebase ko detailed me check karna he and test karna he every feature ko then aapko muje report dena he as like answer dena he mere below mentioned question ka as like abhi jo me bol raha hu vo implemented and working he ya nahi

1> web gateway feature me jab bhi me policy banata hu manlo ki chatgpt.com or claude.ai ko block karna he then aap jab browser open karte ho tab ye sari sites block hoti he ya nahi? and block hone vakt hamara custom company ka html page open hota he ya nahi

2> same web gateway me koi bhi user kuch bhi open karta he then vaha pe hum check karte he ki jo bhi site he vo secure he ya nahi deep level pe and agar secure na ho to vo site block ho rahi he properly

3> jo bhi aap web gateway ki police banate ho vo app level pe bhi kam karti he jaise ki me chatgpt.com ki app ko download ya open ya install karne ki try karta hu tab block hota he and hame custom block page ya kuch instruction dikhta he?

4> jo bhi employee kuch bhi app ko install karta he jaise through terminal ki manual download karke to vaha pe jo bhi app install hota ho uske sare logs company me dikhta he tenant based? means manlo ki employee codex install karta he to logs aane chaiye manlo ki employee vs code install kare to uska bhi log dikhna chaiye and manlo ki company ko vo app ko bandh karna he employee k laptop me so company vo app ko block kare vo user k liye to vo user app ko use na kare

5> jo bhi chiz aap download karte ho ya to web se ya application se vo sare document scan hote he? if yes then agar vo malisiaus or virus ho to vaha pe kuch dikhta he as like kyu block ho raha he (badi file ho to sandbox implementation and check in their behaviour)

6> jab devices me employee ko company se laptop mila ho to screenshot and protesion 24/7 on rehna chaiye and jab employee ka khud ka laptop ho to disconnect ka option aana chaiye client connector me and company ka laptop ho to disconnect ka option nahi aana chaiye

7> abhi dlp me koi sensitive information hoti he to block hota he but muje aisa nahi chaiye manlo ki app level ho ya browser level kahi pe bhi me koi document ya text me sensitive information ho company ki like access token, github project url, koi company ka document ya koi bhi company ki details ho vo sb only log hoke company ko dikhna chaiye block hame kuch bhi nahi karna only company ko dikhna chaiye ki ye employee ne ye upload kiya tha ya ye message kiya tha

8> sare activity logs proper activity tabs pe dikhne chaiye

abhi me aapkko exact batata hu company dashboard me sidebar me kon konsi tab chaiye and usme kya hona chaiye

company dashboard sidebar
=>Dashboard: all statical and visualize data dikhna chaiye jaha pe sara record and sari details honi chaiye
=>Teams: yaha pe basically company team create kar chakna chaiye and uske cruds properly working karna chaiye
=>Employee: company employee ko add kar chake and teams ko tag kar chake ki vo employee konse teams se he and uske cruds working karna chaiye
=>Devices: jo bhi device abhi connected he employee side se vo sare employee k devices ka data dikhna chaiye and connect disconnect ki activity bhi dikhni chaiye timing k sath properly
=>Team & access: yaha pe vo company ki koi or roles management karna he jaise ki company k manager ya kisi or ko koi role assign karke some of the permission deni ho to kar chake
=>police categories: yaha pe employee sari police ki categories ki define kar chake (abhi jo he vo complete he)
=>Global policies ki tag nahi chaiye because vo required nahi he (important)
=>Web Gateway: yaha pe basically company specific web gateway k liye policy create kar chake through domain pattern, specific domain decide karke block or alert ki policy create kar chake and jo bhi policy created ho uski list dikhe pagination k sath and jo bhi specific web gateway k related activity ho vo ye tab me dikhni chaiye everything jo web gateway k related ho vo dikhna chaiye
logs me below mentioned field hone chaiye
employee name, domain, Action(Web request/application/malware), Reason/Policy, category, Risk score, Time
=>Application Control
yaha pe employee based pe employee ne jo bhi application install ki ho vo sari dikhni chaiye
manlo ki employee outlook ko download and install karta he vo sare application ki details yaha pe dikhni chaiye mene below fields mention ki he vo sari fields dikhni chaiye
Employee name, application name, Category, Risk, Network Block(switch as like block karna he ya nahi),App Block (switch as like block karna he ya nahi), Time(kab install kiya tha)
=> Data loss Prevention
yaha pe basically sare dlp k regarding logs aane chaiye (specifically DLP k logs), policy aisa kuch create karne ka nahi aana chaiye by default DLP on hona chaiye with ssl inspection bhi on hona chaiye by default har ek company k liye, DLP k liye only logs dikhne chaiye with below fields he uske sath
Employee name, request(app/browser), destination(app ka name ya browser ka domain name), category(text/file-upload), Reason, risk score, time
=> Activity(yaha pe sare activity logs aane chaiye as like web gateway, DLP, application install logs, download protection logs, device posture logs(every day only 1 time hi aana chaiye))
=> Screenshots
yaha pe employee k pc me jo bhi screenshot capture huae ho vo sare dikhne chaiye and sath me screenshot k baju me jo jo apps open ho vo dikhne chaiye screenshot maise find karke jaise vs code open he or outlook open he ya teams open he vo sb dikhne chaiye
=> Access Requests:
yaha pe manlo ki kisi employee ne access k liye request kiya ho to vo dikhne chaiye and jab me kisi user ko yaha se access granted karu to vo employee access kar chakna chaiye
=> Reports:
yaha pe sare reports aane chaiye (abhi boht sare reports already present he) and export ka bhi option aana chaiye
=> AI Assistant: AI assistant entire things working honi chaiye
=> support: koi bhi employee ne ticket generate ki ho to vo sari dikhni chaiye and company usko close ye open ya ticket ki conversation puri dikhni chaiye